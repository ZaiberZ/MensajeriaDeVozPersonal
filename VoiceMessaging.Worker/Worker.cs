using AlexaSkillWhatsApp.Services;
using Shared.Configuration;
using Shared.Models;
using System.Diagnostics;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using VoiceMessaging.Worker.Models;
using VoiceMessaging.Worker.Services;

namespace VoiceMessaging.Worker;

public class Worker : BackgroundService
{
    private static readonly TimeSpan ReadReconciliationInterval = TimeSpan.FromHours(4);
    private static readonly TimeSpan ReadReconciliationRetryInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan FavoriteMessagesSyncInterval = TimeSpan.FromHours(3);
    private static readonly TimeSpan FavoriteMessagesSyncRetryInterval = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(50);
    private static readonly TimeSpan StartupReadinessCheckInterval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan InternetConnectionRetryInterval = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan InternetConnectionWarningDelay = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan ErrorLogReportCheckInterval = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan FirebaseErrorLogSyncInterval = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan AlexaWriteTraceCleanupInterval = TimeSpan.FromDays(1);
    private static readonly TimeSpan FailedAlexaConversationSyncInterval = TimeSpan.FromHours(6);
    private const int ErrorLogReportLimit = 10;
    private const int FirebaseErrorLogSnapshotLimit = 10;
    private const int FirebaseErrorLogRetentionDays = 30;
    private static readonly bool SupportEmailReportsEnabled = false;
    private readonly ILogger<Worker> _logger;
    private readonly IConfiguration _configuration;
    private static readonly string GatewayDirectory = Path.Combine(AppContext.BaseDirectory, "WhatsAppGateway");
    private static readonly string DataRoot = Environment.GetEnvironmentVariable("VOICE_MESSAGING_DATA_DIR") ?? Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
    private static readonly string FirebaseLogSyncMarkerPath = Path.Combine(DataRoot, "VoiceMessaging", "firebase-error-log-sync-date.txt");
    private static readonly string ErrorLogReportMarkerPath = Path.Combine(DataRoot, "VoiceMessaging", "last-error-log-report-at.txt");
    private readonly string sourceName = "Voice Messaging Worker";
    private readonly string logName = "Application";
    private readonly EventLog eventLog;
    private UserDto _user = new();
    private Process? _gatewayProcess;
    private StreamWriter? _gatewayLogWriter;
    private readonly object _gatewayLogLock = new();
    private DateTime? _lastErrorLogReportAt;
    private DateTime? _lastAlexaWriteTraceCleanupAt;

    public Worker(ILogger<Worker> logger, IConfiguration configuration)
    {
        _logger = logger;
        _configuration = configuration;

        // 1. Register source if it doesn't exist (Requires Admin Privileges)
        if (!EventLog.SourceExists(sourceName))
        {
            EventLog.CreateEventSource(sourceName, logName);
        }

        eventLog = new EventLog(logName);
        eventLog.Source = sourceName;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await WaitForStartupDelayUnlessFirebaseIsReadyAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested && !await EnsureWhatsAppGatewayIsRunningAsync(stoppingToken, logUnavailableWarning: false))
        {
            await Task.Delay(5000, stoppingToken);
        }

        var client = new HttpClient { BaseAddress = new Uri(_configuration["WhatsAppGateway:Url"]!) };
        var whatsApp = new WhatsAppService(client);
        var airbnbClient = new HttpClient { BaseAddress = new Uri(_configuration["AirbnbGateway:BaseUrl"] ?? _configuration["WhatsAppGateway:Url"]!) };
        var airbnb = new AirbnbService(airbnbClient);
        var airbnbGatewayEnabled = false;
        var airbnbCheckInterval = TimeSpan.FromSeconds(Math.Max(10, _configuration.GetValue("AirbnbGateway:CheckIntervalSeconds", 60)));
        var missingUserWarningLogged = false;

        while (string.IsNullOrWhiteSpace(_user.Phone) && !stoppingToken.IsCancellationRequested)
        {
            if (!missingUserWarningLogged)
            {
                _logger.LogWarning("El gateway está disponible, pero el usuario todavía no tiene un teléfono registrado.");
                missingUserWarningLogged = true;
            }

            await ReportWorkerWaitingForUserAsync(whatsApp, stoppingToken);
            await Task.Delay(5000, stoppingToken);

            if (!await IsGatewayRunningAsync(stoppingToken))
                await EnsureWhatsAppGatewayIsRunningAsync(stoppingToken);
        }

        if (stoppingToken.IsCancellationRequested)
            return;

        var firebase = new FirebaseService(_user);
        var whatsAppProcessor = new WhatsAppMessageProcessor(whatsApp, firebase, _logger, RegisterWorkerLogAsync);
        var airbnbProcessor = new AirbnbMessageProcessor(airbnb, firebase, _logger, RegisterWorkerLogAsync, airbnbGatewayEnabled);
        var pendingReplyProcessor = new PendingReplyProcessor(whatsAppProcessor, airbnbProcessor, firebase, _logger, RegisterWorkerLogAsync);
        await WaitForInternetConnectionAsync(firebase, stoppingToken);
        await SyncDailyErrorLogsToFirebaseAsync(whatsApp, firebase, stoppingToken);
        await CleanupOldAlexaWriteTracesAsync(firebase, stoppingToken);
        await SyncFailedAlexaConversationsAsync(whatsApp, firebase, stoppingToken);
        await ReportUnreportedErrorLogsAsync(whatsApp, firebase, stoppingToken);
        await RegisterWorkerStartedAtAsync(stoppingToken);
        await ReportWorkerStatusAsync(whatsApp, firebase, stoppingToken);
        var whatsAppConnected = await whatsApp.IsConnectedAsync(stoppingToken);
        var initialReadReconciliationCompleted = whatsAppConnected && await whatsAppProcessor.ReconcileUnreadMessagesAsync(stoppingToken);
        await DeleteOldReadMessagesAsync(firebase, stoppingToken);
        var initialFavoriteSyncCompleted = whatsAppConnected && await whatsAppProcessor.SyncFavoriteContactMessagesAsync(stoppingToken);

        if (!whatsAppConnected)
            _logger.LogInformation("La reconciliación y la sincronización de favoritos esperarán hasta que WhatsApp esté conectado.");

        var nextReadReconciliationAt = DateTime.UtcNow.Add(initialReadReconciliationCompleted ? ReadReconciliationInterval : ReadReconciliationRetryInterval);
        var nextFavoriteMessagesSyncAt = DateTime.UtcNow.Add(initialFavoriteSyncCompleted ? FavoriteMessagesSyncInterval : FavoriteMessagesSyncRetryInterval);
        var nextAirbnbCheckAt = DateTime.UtcNow;
        var nextErrorLogReportCheckAt = GetNextErrorLogReportCheckAtUtc();
        var nextFailedAlexaConversationSyncAt = DateTime.UtcNow.Add(FailedAlexaConversationSyncInterval);
        while (!stoppingToken.IsCancellationRequested)
        {
            if (!await IsGatewayRunningAsync(stoppingToken))
            {
                _logger.LogWarning("WhatsAppGateway dejó de responder. Intentando reiniciarlo...");

                if (!await EnsureWhatsAppGatewayIsRunningAsync(stoppingToken))
                {
                    await Task.Delay(5000, stoppingToken);
                    continue;
                }

                await RegisterWorkerLogAsync("warning", "WhatsAppGateway dejó de responder y fue reiniciado por el Worker.", null, stoppingToken);
                whatsAppConnected = await whatsApp.IsConnectedAsync(stoppingToken);
                var restartReadReconciliationCompleted = whatsAppConnected && await whatsAppProcessor.ReconcileUnreadMessagesAsync(stoppingToken);
                var restartFavoriteSyncCompleted = whatsAppConnected && await whatsAppProcessor.SyncFavoriteContactMessagesAsync(stoppingToken);
                nextReadReconciliationAt = DateTime.UtcNow.Add(restartReadReconciliationCompleted ? ReadReconciliationInterval : ReadReconciliationRetryInterval);
                nextFavoriteMessagesSyncAt = DateTime.UtcNow.Add(restartFavoriteSyncCompleted ? FavoriteMessagesSyncInterval : FavoriteMessagesSyncRetryInterval);
            }

            var manualFavoriteSyncRequested = await whatsApp.ConsumeFavoriteMessagesSyncRequestAsync(stoppingToken);

            if (manualFavoriteSyncRequested)
            {
                _logger.LogInformation("Se recibió una solicitud manual para sincronizar los mensajes de contactos favoritos.");
                await RegisterWorkerLogAsync("info", "Se recibió una solicitud manual para sincronizar los mensajes de contactos favoritos.", null, stoppingToken);
                nextFavoriteMessagesSyncAt = DateTime.UtcNow;
            }

            if (DateTime.UtcNow >= nextErrorLogReportCheckAt)
            {
                await SyncDailyErrorLogsToFirebaseAsync(whatsApp, firebase, stoppingToken);
                await CleanupOldAlexaWriteTracesAsync(firebase, stoppingToken);
                await ReportUnreportedErrorLogsAsync(whatsApp, firebase, stoppingToken);
                nextErrorLogReportCheckAt = GetNextErrorLogReportCheckAtUtc();
            }

            if (DateTime.UtcNow >= nextFailedAlexaConversationSyncAt)
            {
                nextFailedAlexaConversationSyncAt = DateTime.UtcNow.Add(FailedAlexaConversationSyncInterval);
                await SyncFailedAlexaConversationsAsync(whatsApp, firebase, stoppingToken);
            }

            if (DateTime.UtcNow >= nextReadReconciliationAt)
            {
                var readReconciliationCompleted = await whatsApp.IsConnectedAsync(stoppingToken) &&
                    await whatsAppProcessor.ReconcileUnreadMessagesAsync(stoppingToken);
                nextReadReconciliationAt = DateTime.UtcNow.Add(readReconciliationCompleted ? ReadReconciliationInterval : ReadReconciliationRetryInterval);
            }

            if (DateTime.UtcNow >= nextFavoriteMessagesSyncAt)
            {
                var favoriteSyncSource = manualFavoriteSyncRequested ? "manual" : "automática";
                var favoriteSyncCompleted = false;

                if (!await whatsApp.IsConnectedAsync(stoppingToken))
                {
                    var message = $"La sincronización {favoriteSyncSource} de favoritos no se ejecutó porque WhatsApp no está conectado. Se reintentará en {FavoriteMessagesSyncRetryInterval.TotalMinutes:0} minutos.";
                    _logger.LogWarning(message);
                    await RegisterWorkerLogAsync("warning", message, null, stoppingToken);
                }
                else
                {
                    _logger.LogInformation("Iniciando sincronización {source} de mensajes de contactos favoritos.", favoriteSyncSource);
                    favoriteSyncCompleted = await whatsAppProcessor.SyncFavoriteContactMessagesAsync(stoppingToken);
                }

                nextFavoriteMessagesSyncAt = DateTime.UtcNow.Add(favoriteSyncCompleted ? FavoriteMessagesSyncInterval : FavoriteMessagesSyncRetryInterval);

                if (manualFavoriteSyncRequested)
                    await whatsApp.ReportFavoriteMessagesSyncResultAsync(favoriteSyncCompleted, stoppingToken);
            }

            if (airbnbGatewayEnabled && DateTime.UtcNow >= nextAirbnbCheckAt)
            {
                nextAirbnbCheckAt = DateTime.UtcNow.Add(airbnbCheckInterval);

                try
                {
                    if (await firebase.IsAirbnbEnabledAsync(stoppingToken) && await airbnbProcessor.IsEnabledAsync(stoppingToken))
                        await airbnbProcessor.SaveNewMessagesAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "No fue posible consultar o procesar Airbnb. WhatsApp continuará funcionando.");
                    await RegisterWorkerLogAsync("error", "No fue posible consultar o procesar Airbnb.", ex.ToString(), stoppingToken);
                }
            }

            bool hasPendingReplies;

            try
            {
                hasPendingReplies = await firebase.HasPendingRepliesAsync();
            }
            catch (HttpRequestException ex) when (ex.StatusCode is null)
            {
                await WaitForInternetConnectionAsync(firebase, stoppingToken, ex);
                continue;
            }
            catch (TaskCanceledException ex) when (!stoppingToken.IsCancellationRequested)
            {
                await WaitForInternetConnectionAsync(firebase, stoppingToken, ex);
                continue;
            }

            await whatsAppProcessor.SaveNewMessagesAsync(stoppingToken);
            await pendingReplyProcessor.ProcessAsync(hasPendingReplies, stoppingToken);
            await ReportWorkerStatusAsync(whatsApp, firebase, stoppingToken);
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }

    }

    private async Task WaitForStartupDelayUnlessFirebaseIsReadyAsync(CancellationToken stoppingToken)
    {
        var startupWaitTime = Stopwatch.StartNew();

        while (startupWaitTime.Elapsed < StartupDelay && !stoppingToken.IsCancellationRequested)
        {
            if (await EnsureWhatsAppGatewayIsRunningAsync(stoppingToken, logUnavailableWarning: false) &&
                !string.IsNullOrWhiteSpace(_user.Phone) &&
                await IsFirebaseReadyAsync(new FirebaseService(_user), stoppingToken))
            {
                _logger.LogInformation("Firebase ya responde correctamente. Se omite el retraso inicial del Worker.");
                return;
            }

            var remainingDelay = StartupDelay - startupWaitTime.Elapsed;
            var delay = remainingDelay < StartupReadinessCheckInterval ? remainingDelay : StartupReadinessCheckInterval;

            if (delay > TimeSpan.Zero)
                await Task.Delay(delay, stoppingToken);
        }
    }

    private static async Task<bool> IsFirebaseReadyAsync(FirebaseService firebase, CancellationToken stoppingToken)
    {
        try
        {
            await firebase.EnsureUserRegisteredAsync(stoppingToken);
            return true;
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (TaskCanceledException)
        {
            return false;
        }
    }

    private async Task WaitForInternetConnectionAsync(FirebaseService firebase, CancellationToken stoppingToken, Exception? connectionException = null)
    {
        var waitingForConnection = connectionException != null;
        var warningLogged = false;
        var connectionWaitTime = Stopwatch.StartNew();
        var lastConnectionException = connectionException;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await firebase.EnsureUserRegisteredAsync(stoppingToken);

                if (warningLogged)
                    _logger.LogInformation("Conexión con Firebase restablecida. El Worker continuará procesando mensajes.");

                return;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                throw;
            }
            catch (HttpRequestException ex) when (ex.StatusCode is null)
            {
                waitingForConnection = true;
                lastConnectionException = ex;
            }
            catch (TaskCanceledException ex)
            {
                waitingForConnection = true;
                lastConnectionException = ex;
            }

            if (waitingForConnection && !warningLogged && connectionWaitTime.Elapsed >= InternetConnectionWarningDelay)
            {
                warningLogged = true;
                _logger.LogWarning(lastConnectionException, "Sin conexión con Firebase. El Worker esperará a que Internet vuelva a estar disponible.");
                await RegisterWorkerLogAsync("warning", "Sin conexión con Firebase. El Worker está esperando a que Internet vuelva a estar disponible.", lastConnectionException?.ToString(), stoppingToken);
            }

            await Task.Delay(InternetConnectionRetryInterval, stoppingToken);
        }
    }

    private async Task RegisterWorkerStartedAtAsync(CancellationToken stoppingToken)
    {
        var userId = new string(_user.Phone.Where(char.IsDigit).ToArray());

        if (string.IsNullOrWhiteSpace(userId))
            throw new InvalidOperationException("No se puede registrar el inicio del Worker porque el usuario no tiene un teléfono válido.");

        using var httpClient = FirebaseHttpClient.Create();
        var response = await httpClient.PutAsJsonAsync($"{FirebaseSettings.User(userId)}/control/last_worker_started_at.json", AppClock.Now, stoppingToken);
        response.EnsureSuccessStatusCode();
    }

    private async Task ReportWorkerWaitingForUserAsync(WhatsAppService whatsApp, CancellationToken stoppingToken)
    {
        try
        {
            await whatsApp.ReportWorkerStatusAsync(false, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "No fue posible actualizar el estado inicial del Worker en el gateway.");
        }
    }

    private async Task ReportWorkerStatusAsync(WhatsAppService whatsApp, FirebaseService firebase, CancellationToken stoppingToken)
    {
        try
        {
            var hasPendingMessages = await firebase.HasPendingMessagesAsync();
            await whatsApp.ReportWorkerStatusAsync(hasPendingMessages, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "No fue posible actualizar el estado del Worker en el gateway.");
        }
    }

    private async Task DeleteOldReadMessagesAsync(FirebaseService firebase, CancellationToken stoppingToken)
    {
        try
        {
            var cutoff = AppClock.Now.AddDays(-4);
            var deletedMessages = await firebase.DeleteReadMessagesOlderThanAsync(cutoff);

            _logger.LogInformation(
                "Limpieza inicial completada. Se eliminaron {count} mensajes leídos anteriores a {cutoff}.",
                deletedMessages, cutoff);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error limpiando mensajes leídos antiguos.");
            await RegisterWorkerLogAsync("error", "Error limpiando mensajes leídos antiguos.", ex.ToString(), stoppingToken);
        }
    }

    private async Task ReportUnreportedErrorLogsAsync(WhatsAppService whatsApp, FirebaseService firebase, CancellationToken stoppingToken)
    {
        try
        {
            var hasSupportDestination = !string.IsNullOrWhiteSpace(_user.SupportPhone) ||
                SupportEmailReportsEnabled && !string.IsNullOrWhiteSpace(_user.SupportEmail);

            if (!hasSupportDestination)
            {
                await SaveErrorLogReportStatusAsync(firebase, "skipped_no_support_destination", "No hay teléfono de soporte configurado.", stoppingToken);
                return;
            }

            // El reporte queda pendiente hasta que WhatsApp esté listo para confirmar el envío.
            if (!string.IsNullOrWhiteSpace(_user.SupportPhone) && !await whatsApp.IsConnectedAsync(stoppingToken))
            {
                _logger.LogDebug("El reporte diario de errores esperará a que WhatsApp esté conectado.");
                await SaveErrorLogReportStatusAsync(firebase, "waiting_for_whatsapp", "WhatsApp todavía no está listo para enviar el reporte.", stoppingToken);
                return;
            }

            var now = DateTime.UtcNow;
            var today = AppClock.Now.Date;
            var lastReportAt = _lastErrorLogReportAt;
            var localLastReportAt = await GetLocalLastErrorLogReportAtAsync(stoppingToken);

            if (localLastReportAt.HasValue && (!lastReportAt.HasValue || localLastReportAt.Value > lastReportAt.Value))
                lastReportAt = localLastReportAt;

            try
            {
                var firebaseLastReportAt = await firebase.GetLastErrorLogsReportedAtAsync(stoppingToken);

                if (firebaseLastReportAt.HasValue && (!lastReportAt.HasValue ||
                    firebaseLastReportAt.Value.ToUniversalTime() > lastReportAt.Value.ToUniversalTime()))
                    lastReportAt = firebaseLastReportAt;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "No fue posible consultar en Firebase la fecha del ultimo reporte de errores; se usara el estado local.");
            }

            if (lastReportAt.HasValue && AppClock.ToLocalTime(lastReportAt.Value).Date == today)
            {
                _lastErrorLogReportAt = lastReportAt.Value.ToUniversalTime();
                await SaveErrorLogReportStatusAsync(firebase, "already_reported_today", $"El último reporte confirmado fue {lastReportAt.Value:O}.", stoppingToken, lastReportAt);
                return;
            }

            var logsResponse = await whatsApp.GetUnreportedErrorLogsAsync(ErrorLogReportLimit, lastReportAt, stoppingToken);
            var failedConversations = await whatsApp.GetFailedConversationsAsync(stoppingToken);

            if (logsResponse.Logs.Count == 0 && failedConversations.NewCount == 0)
            {
                await SaveErrorLogReportStatusAsync(firebase, "no_unreported_errors", "El gateway no tiene errores ni conversaciones nuevas con error de envío.", stoppingToken, lastReportAt, logsResponse.Count);
                return;
            }

            var logIds = logsResponse.AllIds.Where(id => !string.IsNullOrWhiteSpace(id)).ToList();

            if (logsResponse.Logs.Count > 0 && logIds.Count == 0)
            {
                await SaveErrorLogReportStatusAsync(firebase, "invalid_gateway_response", "El gateway devolvió errores sin identificadores para marcarlos.", stoppingToken, lastReportAt, logsResponse.Count);
                return;
            }

            var report = BuildErrorLogsReport(logsResponse, failedConversations);
            var reportSent = false;
            Exception? emailError = null;

            if (SupportEmailReportsEnabled && !string.IsNullOrWhiteSpace(_user.SupportEmail))
            {
                try
                {
                    var subject = $"[VoiceMessaging] Errores de {_user.FullName} ({_user.Phone})";
                    await whatsApp.SendSupportEmailAsync(subject, report, stoppingToken);
                    reportSent = true;
                    _logger.LogInformation("Reporte diario de errores enviado al correo de soporte {email}.", _user.SupportEmail);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    emailError = ex;
                    _logger.LogWarning(ex, "No fue posible enviar el reporte al correo de soporte. Se intentara usar WhatsApp.");
                }
            }

            if (!reportSent && !string.IsNullOrWhiteSpace(_user.SupportPhone))
            {
                // Se vuelve a comprobar justo antes de enviar para evitar consumir el intento si la sesión cambió.
                if (!await whatsApp.IsConnectedAsync(stoppingToken))
                {
                    await SaveErrorLogReportStatusAsync(firebase, "waiting_for_whatsapp", "WhatsApp se desconectó antes del envío.", stoppingToken, lastReportAt, logsResponse.Count);
                    return;
                }

                var reportIdempotencyKey = $"daily-error-report:{_user.Phone}:{AppClock.Now:yyyy-MM-dd}";
                var confirmationId = await whatsApp.SendMessageAsync(_user.SupportPhone, report, reportIdempotencyKey, stoppingToken);
                reportSent = true;
                _logger.LogInformation("Reporte diario de errores confirmado por WhatsApp con el identificador {messageId}.", confirmationId);
            }

            if (!reportSent)
                throw new InvalidOperationException("No fue posible enviar el reporte por correo ni por WhatsApp.", emailError);

            // El marcador local se guarda inmediatamente tras la confirmación para impedir duplicados después de un reinicio.
            _lastErrorLogReportAt = now;
            await SaveLocalLastErrorLogReportAtAsync(now, stoppingToken);

            if (logIds.Count > 0)
            {
                try
                {
                    await whatsApp.MarkLogsAsReportedAsync(logIds, stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "El reporte fue enviado, pero no se pudieron marcar todos los logs. El cursor local evitará repetirlos.");
                }
            }

            try
            {
                await firebase.SetLastErrorLogsReportedAtAsync(now, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "El reporte se envio, pero no fue posible guardar en Firebase su fecha de envio.");
            }

            _logger.LogInformation("Reporte diario confirmado: {logCount} logs y aviso de {conversationCount} conversaciones nuevas con error.", logIds.Count, failedConversations.NewCount);
            await SaveErrorLogReportStatusAsync(firebase, "sent", $"Se confirmó el reporte de {logIds.Count} logs y el aviso de {failedConversations.NewCount} conversaciones nuevas con error.", stoppingToken, now, logIds.Count);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "No fue posible enviar el reporte diario de errores por correo ni por WhatsApp.");
            await SaveErrorLogReportStatusAsync(firebase, "failed", ex.Message, stoppingToken);
            await RegisterWorkerLogAsync("error", "No fue posible enviar el reporte diario de errores por correo ni por WhatsApp.", ex.ToString(), stoppingToken);
        }
    }

    private DateTime GetNextErrorLogReportCheckAtUtc()
    {
        if (!_lastErrorLogReportAt.HasValue || AppClock.ToLocalTime(_lastErrorLogReportAt.Value).Date != AppClock.Now.Date)
            return DateTime.UtcNow.Add(ErrorLogReportCheckInterval);

        var nextLocalCheck = AppClock.Now.Date.AddDays(1).AddMinutes(5);
        return DateTime.UtcNow.Add(nextLocalCheck - AppClock.Now);
    }

    private static async Task<DateTime?> GetLocalLastErrorLogReportAtAsync(CancellationToken stoppingToken)
    {
        try
        {
            if (!File.Exists(ErrorLogReportMarkerPath))
                return null;

            var value = await File.ReadAllTextAsync(ErrorLogReportMarkerPath, stoppingToken);
            return DateTime.TryParse(value, null, System.Globalization.DateTimeStyles.RoundtripKind, out var parsed) ? parsed.ToUniversalTime() : null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static async Task SaveLocalLastErrorLogReportAtAsync(DateTime reportedAt, CancellationToken stoppingToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ErrorLogReportMarkerPath)!);
        await File.WriteAllTextAsync(ErrorLogReportMarkerPath, reportedAt.ToUniversalTime().ToString("O"), stoppingToken);
    }

    private async Task SaveErrorLogReportStatusAsync(FirebaseService firebase, string outcome, string reason, CancellationToken stoppingToken, DateTime? lastReportAt = null, int? unreportedErrorCount = null)
    {
        try
        {
            await firebase.SetErrorLogReportStatusAsync(new
            {
                checkedAt = AppClock.Now,
                outcome,
                reason,
                supportPhoneConfigured = !string.IsNullOrWhiteSpace(_user.SupportPhone),
                lastReportAt,
                unreportedErrorCount
            }, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No se pudo guardar en Firebase el diagnóstico del reporte diario de errores.");
        }
    }

    private async Task CleanupOldAlexaWriteTracesAsync(FirebaseService firebase, CancellationToken stoppingToken)
    {
        var now = AppClock.Now;

        if (_lastAlexaWriteTraceCleanupAt.HasValue && now - _lastAlexaWriteTraceCleanupAt.Value < AlexaWriteTraceCleanupInterval)
            return;

        try
        {
            // Los seguimientos incompletos se conservan solo durante quince días.
            var cutoff = now.AddDays(-15);
            var deletedCount = await firebase.DeleteAlexaWriteTracesOlderThanAsync(cutoff, stoppingToken);
            var deletedDiagnosticLogs = await firebase.DeleteDiagnosticLogsOlderThanAsync(cutoff, stoppingToken);
            _lastAlexaWriteTraceCleanupAt = now;
            _logger.LogInformation("Limpieza de diagnósticos de Alexa completada. Seguimientos eliminados: {traceCount}; logs eliminados: {logCount}.", deletedCount, deletedDiagnosticLogs);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No fue posible eliminar los seguimientos de escritura de Alexa vencidos.");
        }
    }

    private async Task SyncFailedAlexaConversationsAsync(WhatsAppService whatsApp, FirebaseService firebase, CancellationToken stoppingToken)
    {
        try
        {
            // Firebase es la fuente de verdad: sólo permanecen los dictados cuyo envío no fue confirmado.
            var traces = await firebase.GetAlexaWriteTracesAsync(stoppingToken);
            var pendingReplies = await firebase.GetPendingRepliesAsync();
            var pendingByTraceId = pendingReplies
                .Where(reply => !string.IsNullOrWhiteSpace(reply.AlexaWriteTraceId))
                .GroupBy(reply => reply.AlexaWriteTraceId)
                .ToDictionary(group => group.Key, group => group.First());
            var localCopies = traces
                .Where(item => !string.Equals(item.Value.Status, "queued_for_delivery", StringComparison.OrdinalIgnoreCase))
                .Select(item =>
            {
                pendingByTraceId.TryGetValue(item.Key, out var pending);
                var isNewMessage = pending != null
                    ? string.IsNullOrWhiteSpace(pending.MessageId)
                    : item.Value.Turns.Any(turn => turn.Contains("WriteContactMessageIntent", StringComparison.OrdinalIgnoreCase));

                return (object)new
                {
                    id = item.Key,
                    operation = isNewMessage ? "new_message" : "reply",
                    recipient = pending?.Sender ?? "",
                    item.Value.SessionId,
                    item.Value.StartedAt,
                    item.Value.UpdatedAt,
                    item.Value.Status,
                    item.Value.Turns
                };
            }).ToList();

            await whatsApp.SyncFailedConversationsAsync(localCopies, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No fue posible sincronizar localmente los seguimientos de escritura pendientes de Alexa.");
            await RegisterWorkerLogAsync("warning", "No fue posible sincronizar localmente los seguimientos de escritura pendientes de Alexa.", ex.ToString(), stoppingToken);
        }
    }

    private async Task SyncDailyErrorLogsToFirebaseAsync(WhatsAppService whatsApp, FirebaseService firebase, CancellationToken stoppingToken)
    {
        try
        {
            var now = AppClock.Now;
            var today = now.Date;
            string? previousFingerprint = null;

            if (File.Exists(FirebaseLogSyncMarkerPath))
            {
                var markerLines = await File.ReadAllLinesAsync(FirebaseLogSyncMarkerPath, stoppingToken);

                if (markerLines.Length > 0 && DateTime.TryParse(markerLines[0], null, System.Globalization.DateTimeStyles.RoundtripKind, out var lastSyncAt))
                {
                    if (now - lastSyncAt < FirebaseErrorLogSyncInterval)
                        return;

                    if (lastSyncAt.Date == today)
                        previousFingerprint = markerLines.Length > 1 ? markerLines[1] : null;
                }
            }

            var logsResponse = await whatsApp.GetErrorLogsAsync(FirebaseErrorLogSnapshotLimit, stoppingToken);
            var fingerprintContent = string.Join("\n", logsResponse.Logs.Select(log =>
                $"{log.Id}|{log.LastAttemptAt:O}|{log.AttemptCount}|{log.Message}|{log.Detail}"));
            var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(fingerprintContent)));

            if (string.Equals(previousFingerprint, fingerprint, StringComparison.Ordinal))
                return;

            if (logsResponse.Logs.Count > 0)
            {
                var snapshot = new DailyErrorLogSnapshotDto
                {
                    CapturedAt = AppClock.NowOffset,
                    Count = logsResponse.Count,
                    Logs = logsResponse.Logs.Select(log => new ErrorLogSnapshotItemDto
                    {
                        Timestamp = AppClock.ToLocalTime(log.Timestamp),
                        LastAttemptAt = AppClock.ToLocalTime(log.LastAttemptAt),
                        Source = TruncateForFirebase(log.Source, 100),
                        Message = TruncateForFirebase(log.Message, 500),
                        Detail = string.IsNullOrWhiteSpace(log.Detail) ? null : TruncateForFirebase(log.Detail, 1500),
                        AttemptCount = log.AttemptCount
                    }).ToList()
                };

                await firebase.SaveDailyErrorLogSnapshotAsync(today, snapshot, stoppingToken);
            }

            await firebase.DeleteDailyErrorLogSnapshotAsync(today.AddDays(-(FirebaseErrorLogRetentionDays + 1)), stoppingToken);
            Directory.CreateDirectory(Path.GetDirectoryName(FirebaseLogSyncMarkerPath)!);
            await File.WriteAllLinesAsync(FirebaseLogSyncMarkerPath, [now.ToString("O"), fingerprint], stoppingToken);
            _logger.LogInformation("Sincronizacion diaria de errores con Firebase completada. Logs incluidos: {count}.", logsResponse.Logs.Count);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No fue posible sincronizar el resumen diario de errores con Firebase. Se reintentara mas tarde.");
            await RegisterWorkerLogAsync("warning", "No fue posible sincronizar el resumen diario de errores con Firebase. Se reintentara mas tarde.", ex.ToString(), stoppingToken);
        }
    }

    private static string TruncateForFirebase(string value, int maxLength)
    {
        if (string.IsNullOrEmpty(value) || value.Length <= maxLength)
            return value;

        return value[..maxLength] + "...";
    }

    private static string BuildErrorLogsReport(GatewayLogsResponseDto logsResponse, FailedConversationsResponseDto failedConversations)
    {
        var builder = new StringBuilder();
        var reportedCount = logsResponse.Logs.Count;

        builder.AppendLine("Reporte diario de errores de Voice Messaging.");
        builder.AppendLine($"Errores sin reportar: {logsResponse.Count}.");
        if (failedConversations.NewCount > 0)
            builder.AppendLine($"Aviso: hay {failedConversations.NewCount} conversaciones nuevas con error de envío. Revísalas en Firebase.");

        if (logsResponse.Count > reportedCount)
            builder.AppendLine($"Se muestran los ultimos {reportedCount}. Errores no incluidos en el mensaje: {logsResponse.Count - reportedCount}.");

        if (logsResponse.Logs.Count > 0)
        {
            builder.AppendLine();
            builder.AppendLine("Errores:");

            foreach (var log in logsResponse.Logs)
            {
                var attemptText = log.AttemptCount > 1 ? $" ({log.AttemptCount} intentos)" : "";
                builder.AppendLine($"- {FormatLogDate(log.LastAttemptAt == default ? log.Timestamp : log.LastAttemptAt)} [{log.Source}]{attemptText}: {CreateLogReportPreview(log.Message)}");
            }
        }

        return builder.ToString().Trim();
    }

    private static string FormatLogDate(DateTimeOffset date)
    {
        if (date == default)
            return "fecha desconocida";

        return AppClock.ToLocalTime(date).ToString("yyyy-MM-dd HH:mm");
    }

    private static string CreateLogReportPreview(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
            return "(sin mensaje)";

        var normalizedMessage = message.ReplaceLineEndings(" ").Trim();

        if (normalizedMessage.Length <= 350)
            return normalizedMessage;

        return normalizedMessage[..350] + "...";
    }

    private async Task RegisterWorkerLogAsync(string level, string message, string? detail, CancellationToken stoppingToken)
    {
        try
        {
            var gatewayUrl = _configuration["WhatsAppGateway:Url"] ?? "http://localhost:3000";

            using var httpClient = new HttpClient
            {
                BaseAddress = new Uri(gatewayUrl),
                Timeout = TimeSpan.FromSeconds(3)
            };

            var response = await httpClient.PostAsJsonAsync("/logs", new { level, message, detail, source = "VoiceMessaging.Worker" }, stoppingToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogDebug("No fue posible registrar el log del Worker en el gateway. Código HTTP: {statusCode}", response.StatusCode);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // El servicio se está deteniendo; no es necesario persistir más logs.
        }
        catch (Exception ex)
        {
            // El registro remoto es de mejor esfuerzo y nunca debe detener al Worker.
            _logger.LogDebug(ex, "No fue posible enviar el log del Worker al gateway.");
        }
    }

    private async Task<bool> EnsureWhatsAppGatewayIsRunningAsync(CancellationToken stoppingToken, bool logUnavailableWarning = true)
    {
        if (await IsGatewayRunningAsync(stoppingToken))
        {
            _logger.LogInformation("WhatsAppGateway ya está ejecutándose.");
            return true;
        }

        if (logUnavailableWarning)
            _logger.LogWarning("WhatsAppGateway no responde. Intentando iniciarlo...");

        if (!StartWhatsAppGateway())
            return false;

        for (int i = 0; i < 200; i++)
        {
            await Task.Delay(3000, stoppingToken);

            if (await IsGatewayRunningAsync(stoppingToken))
            {
                _logger.LogInformation("WhatsAppGateway iniciado correctamente.");
                return true;
            }

            if (_gatewayProcess is { HasExited: true })
            {
                _logger.LogError(
                    "El proceso de WhatsAppGateway terminó antes de responder. Código de salida: {exitCode}",
                    _gatewayProcess.ExitCode);
                break;
            }
        }

        _logger.LogError("No se pudo iniciar WhatsAppGateway.");
        return false;
    }

    private async Task<bool> IsGatewayRunningAsync(CancellationToken stoppingToken)
    {
        try
        {
            var gatewayUrl = _configuration["WhatsAppGateway:Url"] ?? "http://localhost:3000";

            using var httpClient = new HttpClient
            {
                BaseAddress = new Uri(gatewayUrl),
                Timeout = TimeSpan.FromSeconds(3)
            };

            var response = await httpClient.GetAsync("/whatsapp/status", stoppingToken);

            if (!response.IsSuccessStatusCode)
                return false;

            var gatewayStatus = await response.Content.ReadFromJsonAsync<GatewayStatusDto>(cancellationToken: stoppingToken);

            if (gatewayStatus?.User != null)
                _user = gatewayStatus.User;

            return true;
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "WhatsAppGateway no respondió a la consulta de estado.");
            return false;
        }
    }

    private bool StartWhatsAppGateway()
    {
        if (!Directory.Exists(GatewayDirectory))
        {
            _logger.LogError("No se encontró la carpeta WhatsAppGateway en: {path}", GatewayDirectory);
            return false;
        }
        try
        {
            if (_gatewayProcess is { HasExited: false })
            {
                _logger.LogInformation("El proceso de WhatsAppGateway ya está en ejecución; esperando respuesta.");
                return true;
            }

            _gatewayProcess?.Dispose();
            CloseGatewayLogWriter();

            var logPath = Path.Combine(GatewayDirectory, "gateway.log");
            _gatewayLogWriter = new StreamWriter(new FileStream(logPath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
            {
                AutoFlush = true
            };
            WriteGatewayLogLine("Iniciando Gateway...");

            var startInfo = new ProcessStartInfo
            {
                FileName = "node.exe",
                Arguments = "app.js",
                WorkingDirectory = GatewayDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };

            _gatewayProcess = Process.Start(startInfo);

            if (_gatewayProcess == null)
            {
                CloseGatewayLogWriter();
                _logger.LogError("Windows no pudo crear el proceso de WhatsAppGateway.");
                return false;
            }

            _gatewayProcess.EnableRaisingEvents = true;
            _gatewayProcess.OutputDataReceived += (_, args) => WriteGatewayLogLine(args.Data);
            _gatewayProcess.ErrorDataReceived += (_, args) => WriteGatewayLogLine(args.Data);
            _gatewayProcess.Exited += (_, _) => CloseGatewayLogWriter();
            _gatewayProcess.BeginOutputReadLine();
            _gatewayProcess.BeginErrorReadLine();

            _logger.LogInformation("WhatsAppGateway iniciado con node app.js. Ruta: {path}", GatewayDirectory);
            eventLog.WriteEntry("WhatsAppGateway iniciado con node app.js.", EventLogEntryType.Information);
            return true;
        }
        catch (Exception e)
        {
            CloseGatewayLogWriter();
            eventLog.WriteEntry(e.Message, EventLogEntryType.Error);
            _logger.LogError("No se pudo iniciar WhatsAppGateway. Error: " + e.Message);
            return false;
        }

    }

    private void WriteGatewayLogLine(string? line)
    {
        if (line == null)
            return;

        lock (_gatewayLogLock)
        {
            _gatewayLogWriter?.WriteLine(line);
        }
    }

    private void CloseGatewayLogWriter()
    {
        lock (_gatewayLogLock)
        {
            _gatewayLogWriter?.Dispose();
            _gatewayLogWriter = null;
        }
    }
}
