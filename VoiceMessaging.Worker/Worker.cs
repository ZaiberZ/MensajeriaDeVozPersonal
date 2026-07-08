using AlexaSkillWhatsApp.Services;
using Shared.Configuration;
using Shared.Models;
using System.Diagnostics;
using System.Net.Http.Json;
using System.Text;
using VoiceMessaging.Worker.Models;
using VoiceMessaging.Worker.Services;

namespace VoiceMessaging.Worker;

public class Worker : BackgroundService
{
    private static readonly TimeSpan ReadReconciliationInterval = TimeSpan.FromHours(4);
    private static readonly TimeSpan ReadReconciliationRetryInterval = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan InternetConnectionRetryInterval = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan InternetConnectionWarningDelay = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan ErrorLogReportInterval = TimeSpan.FromDays(1);
    private static readonly TimeSpan ErrorLogReportCheckInterval = TimeSpan.FromMinutes(30);
    private const int ErrorLogReportLimit = 10;
    private readonly ILogger<Worker> _logger;
    private readonly IConfiguration _configuration;
    private static readonly string GatewayDirectory = Path.Combine(AppContext.BaseDirectory, "WhatsAppGateway");
    private readonly string sourceName = "Voice Messaging Worker";
    private readonly string logName = "Application";
    private readonly EventLog eventLog;
    private UserDto _user = new();
    private Process? _gatewayProcess;

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
        while (!stoppingToken.IsCancellationRequested && !await EnsureWhatsAppGatewayIsRunningAsync(stoppingToken, logUnavailableWarning: false))
        {
            await Task.Delay(5000, stoppingToken);
        }

        var client = new HttpClient { BaseAddress = new Uri(_configuration["WhatsAppGateway:Url"]!) };
        var whatsApp = new WhatsAppService(client);
        var airbnbClient = new HttpClient { BaseAddress = new Uri(_configuration["AirbnbGateway:BaseUrl"] ?? _configuration["WhatsAppGateway:Url"]!) };
        var airbnb = new AirbnbService(airbnbClient);
        var airbnbGatewayEnabled = _configuration.GetValue<bool>("AirbnbGateway:Enabled");
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
        await RegisterWorkerStartedAtAsync(stoppingToken);
        await ReportWorkerStatusAsync(whatsApp, firebase, stoppingToken);
        var initialReadReconciliationCompleted = await whatsAppProcessor.ReconcileUnreadMessagesAsync(stoppingToken);
        await DeleteOldReadMessagesAsync(firebase, stoppingToken);
        var nextReadReconciliationAt = DateTime.UtcNow.Add(initialReadReconciliationCompleted ? ReadReconciliationInterval : ReadReconciliationRetryInterval);
        var nextAirbnbCheckAt = DateTime.UtcNow;
        var nextErrorLogReportCheckAt = DateTime.UtcNow;
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

                await RegisterWorkerLogAsync("warning", "WhatsAppGateway dejó de responder y fue reiniciado por el Worker.", stoppingToken);
            }

            if (DateTime.UtcNow >= nextErrorLogReportCheckAt)
            {
                nextErrorLogReportCheckAt = DateTime.UtcNow.Add(ErrorLogReportCheckInterval);
                await ReportUnreportedErrorLogsAsync(whatsApp, firebase, stoppingToken);
            }

            if (DateTime.UtcNow >= nextReadReconciliationAt)
            {
                var readReconciliationCompleted = await whatsAppProcessor.ReconcileUnreadMessagesAsync(stoppingToken);
                nextReadReconciliationAt = DateTime.UtcNow.Add(readReconciliationCompleted ? ReadReconciliationInterval : ReadReconciliationRetryInterval);
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
                    await RegisterWorkerLogAsync("error", $"No fue posible consultar o procesar Airbnb: {ex}", stoppingToken);
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
                await RegisterWorkerLogAsync("warning", "Sin conexión con Firebase. El Worker está esperando a que Internet vuelva a estar disponible.", stoppingToken);
            }

            await Task.Delay(InternetConnectionRetryInterval, stoppingToken);
        }
    }

    private async Task RegisterWorkerStartedAtAsync(CancellationToken stoppingToken)
    {
        var userId = new string(_user.Phone.Where(char.IsDigit).ToArray());

        if (string.IsNullOrWhiteSpace(userId))
            throw new InvalidOperationException("No se puede registrar el inicio del Worker porque el usuario no tiene un teléfono válido.");

        using var httpClient = new HttpClient();
        var response = await httpClient.PutAsJsonAsync($"{FirebaseSettings.User(userId)}/control/last_worker_started_at.json", DateTime.UtcNow, stoppingToken);
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
            var cutoff = DateTime.UtcNow.AddDays(-2);
            var deletedMessages = await firebase.DeleteReadMessagesOlderThanAsync(cutoff);

            _logger.LogInformation(
                "Limpieza inicial completada. Se eliminaron {count} mensajes leídos anteriores a {cutoff}.",
                deletedMessages,cutoff);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error limpiando mensajes leídos antiguos.");
            await RegisterWorkerLogAsync("error",$"Error limpiando mensajes leídos antiguos: {ex}",stoppingToken);
        }
    }

    private async Task ReportUnreportedErrorLogsAsync(WhatsAppService whatsApp, FirebaseService firebase, CancellationToken stoppingToken)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(_user.SupportPhone))
                return;

            var lastReportedAt = await firebase.GetLastErrorLogsReportedAtAsync(stoppingToken);

            if (lastReportedAt.HasValue && DateTime.UtcNow - lastReportedAt.Value.ToUniversalTime() < ErrorLogReportInterval)
                return;

            var logsResponse = await whatsApp.GetUnreportedErrorLogsAsync(ErrorLogReportLimit, stoppingToken);

            if (logsResponse.Logs.Count == 0)
                return;

            var logIds = logsResponse.AllIds.Where(id => !string.IsNullOrWhiteSpace(id)).ToList();

            if (logIds.Count == 0)
                return;

            await whatsApp.SendMessageAsync(_user.SupportPhone, BuildErrorLogsReport(logsResponse), stoppingToken);
            await firebase.SetLastErrorLogsReportedAtAsync(DateTime.UtcNow, stoppingToken);
            await whatsApp.MarkLogsAsReportedAsync(logIds, stoppingToken);

            _logger.LogInformation("Reporte diario de errores enviado al telefono de soporte. Logs reportados: {count}.", logIds.Count);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "No fue posible enviar el reporte diario de errores al telefono de soporte.");
            await RegisterWorkerLogAsync("error", $"No fue posible enviar el reporte diario de errores al telefono de soporte: {ex}", stoppingToken);
        }
    }

    private static string BuildErrorLogsReport(GatewayLogsResponseDto logsResponse)
    {
        var builder = new StringBuilder();
        var reportedCount = logsResponse.Logs.Count;

        builder.AppendLine("Reporte diario de errores de Voice Messaging.");
        builder.AppendLine($"Errores sin reportar: {logsResponse.Count}.");

        if (logsResponse.Count > reportedCount)
            builder.AppendLine($"Se muestran los ultimos {reportedCount}. Errores no incluidos en el mensaje: {logsResponse.Count - reportedCount}.");

        builder.AppendLine();

        foreach (var log in logsResponse.Logs)
        {
            var attemptText = log.AttemptCount > 1 ? $" ({log.AttemptCount} intentos)" : "";
            builder.AppendLine($"- {FormatLogDate(log.LastAttemptAt == default ? log.Timestamp : log.LastAttemptAt)} [{log.Source}]{attemptText}: {CreateLogReportPreview(log.Message)}");
        }

        return builder.ToString().Trim();
    }

    private static string FormatLogDate(DateTime date)
    {
        if (date == default)
            return "fecha desconocida";

        return date.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
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

    private async Task RegisterWorkerLogAsync(string level, string message, CancellationToken stoppingToken)
    {
        try
        {
            var gatewayUrl = _configuration["WhatsAppGateway:Url"] ?? "http://localhost:3000";

            using var httpClient = new HttpClient
            {
                BaseAddress = new Uri(gatewayUrl),
                Timeout = TimeSpan.FromSeconds(3)
            };

            var response = await httpClient.PostAsJsonAsync("/logs", new { level, message, source = "VoiceMessaging.Worker" }, stoppingToken);

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

            var logPath = Path.Combine(GatewayDirectory, "gateway.log");

            var startInfo = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/C echo Iniciando Gateway... > \"{logPath}\" && npm start >> \"{logPath}\" 2>&1",
                WorkingDirectory = GatewayDirectory,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            _gatewayProcess = Process.Start(startInfo);

            if (_gatewayProcess == null)
            {
                _logger.LogError("Windows no pudo crear el proceso de WhatsAppGateway.");
                return false;
            }


            _logger.LogInformation("WhatsAppGateway iniciado con npm start. Ruta: {path}", GatewayDirectory);
            eventLog.WriteEntry("WhatsAppGateway iniciado con npm start.", EventLogEntryType.Information);
            return true;
        }
        catch (Exception e)
        {
            eventLog.WriteEntry(e.Message, EventLogEntryType.Error);
            _logger.LogError("No se pudo iniciar WhatsAppGateway. Error: " + e.Message);
            return false;
        }

    }
}
