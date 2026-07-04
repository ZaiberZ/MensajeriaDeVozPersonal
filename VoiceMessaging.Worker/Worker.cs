using AlexaSkillWhatsApp.Services;
using Shared.Models;
using System.Diagnostics;
using System.Net.Http.Json;
using VoiceMessaging.Worker.Services;

namespace VoiceMessaging.Worker;

public class Worker : BackgroundService
{
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
        while (!stoppingToken.IsCancellationRequested &&
               !await EnsureWhatsAppGatewayIsRunningAsync(stoppingToken))
        {
            await Task.Delay(5000, stoppingToken);
        }

        while (string.IsNullOrWhiteSpace(_user.Phone) && !stoppingToken.IsCancellationRequested)
        {
            _logger.LogWarning("El gateway está disponible, pero el usuario todavía no tiene un teléfono registrado.");
            await Task.Delay(3000, stoppingToken);

            if (!await IsGatewayRunningAsync(stoppingToken))
                await EnsureWhatsAppGatewayIsRunningAsync(stoppingToken);
        }

        if (stoppingToken.IsCancellationRequested)
            return;

        var client = new HttpClient { BaseAddress = new Uri(_configuration["WhatsAppGateway:Url"]!) };
        var whatsApp = new WhatsAppService(client);
        var firebase = new FirebaseService(_user);
        await firebase.EnsureUserRegisteredAsync();
        string msgError = "";

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

            msgError += await SaveNewMessages(whatsApp, firebase, stoppingToken);
            msgError += await SendPendingReplies(whatsApp, firebase, stoppingToken);
            await Task.Delay(int.Parse(_configuration["Worker:IntervalSeconds"]!.ToString()), stoppingToken);
        }

    }

    private async Task<string> SaveNewMessages(WhatsAppService whatsApp, FirebaseService firebase, CancellationToken stoppingToken)
    {
        string msgError = "";
        try
        {
            var messages = await whatsApp.GetMessagesAsync();


            foreach (var message in messages)
            {
                try
                {
                    var firebaseMessage = new MessageDto
                    {
                        ChatId = message.ChatId,
                        Phone = message.Phone,
                        Source = message.Source,
                        Account = message.Account,
                        Sender = message.Sender,
                        Text = message.Text,
                        Date = message.Date,
                        IsRead = false
                    };

                    await firebase.SaveIncomingMessageAsync(firebaseMessage);

                    _logger.LogInformation("Mensaje guardado en Firebase: {sender} - {text}", firebaseMessage.Sender, firebaseMessage.Text);
                }
                catch (Exception e)
                {
                    msgError += e.Message + " | ";
                }
            }
            if (!string.IsNullOrEmpty(msgError))
                throw new Exception(msgError);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error guardando mensajes nuevos.");
            await RegisterWorkerLogAsync("error", $"Error guardando mensajes nuevos: {ex}", stoppingToken);
        }

        return msgError;
    }

    private async Task<string> SendPendingReplies(WhatsAppService whatsApp, FirebaseService firebase, CancellationToken stoppingToken)
    {
        string msgError = "";
        try
        {
            var replies = await firebase.GetPendingRepliesAsync();

            foreach (var reply in replies)
            {
                try
                {

                    if (string.IsNullOrWhiteSpace(reply.Phone))
                    {
                        _logger.LogWarning("No se pudo enviar respuesta {id}. No tiene teléfono.", reply.Sender);
                        await RegisterWorkerLogAsync("warning", $"No se pudo enviar la respuesta de {reply.Sender}. No tiene teléfono.", stoppingToken);

                        continue;
                    }

                    await whatsApp.SendReplyAsync(reply);

                    await firebase.DeleteReplyAsync(reply.Id);

                    _logger.LogInformation("Respuesta enviada y eliminada de Firebase: {sender} - {text}", reply.Sender, reply.Text);

                }
                catch (Exception e)
                {
                    msgError += e.Message + " | ";
                }
            }
            if (!string.IsNullOrEmpty(msgError))
                throw new Exception(msgError);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error enviando respuestas pendientes.");
            await RegisterWorkerLogAsync("error", $"Error enviando respuestas pendientes: {ex}", stoppingToken);
        }

        return msgError;
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

    private async Task<bool> EnsureWhatsAppGatewayIsRunningAsync(CancellationToken stoppingToken)
    {
        if (await IsGatewayRunningAsync(stoppingToken))
        {
            _logger.LogInformation("WhatsAppGateway ya está ejecutándose.");
            return true;
        }

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

            var response = await httpClient.GetAsync("/status", stoppingToken);

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
