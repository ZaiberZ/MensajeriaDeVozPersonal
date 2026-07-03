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
        await EnsureWhatsAppGatewayIsRunningAsync();

        while (string.IsNullOrWhiteSpace(_user.Phone) && !stoppingToken.IsCancellationRequested)
        {
            _logger.LogWarning("El gateway está disponible, pero el usuario todavía no tiene un teléfono registrado.");
            await Task.Delay(3000, stoppingToken);
            await IsGatewayRunningAsync();
        }

        if (stoppingToken.IsCancellationRequested)
            return;

        var client = new HttpClient { BaseAddress = new Uri(_configuration["WhatsAppGateway:Url"]!) };
        var whatsApp = new WhatsAppService(client);
        var firebase = new FirebaseService(_user);
        await firebase.EnsureUserRegisteredAsync();
        string msgError;

        while (!stoppingToken.IsCancellationRequested)
        {
            //if (!await IsGatewayRunningAsync())
            //{
            //    await EnsureWhatsAppGatewayIsRunningAsync();

            //    await Task.Delay(5000, stoppingToken);

            //    continue;
            //}

            #region Save new messages
            try
            {
                var messages = await whatsApp.GetMessagesAsync();
                msgError = "";

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
                Console.WriteLine("ERROR: " + ex.Message);
            }
            #endregion

            #region SendMessages
            try
            {
                var replies = await firebase.GetPendingRepliesAsync();
                msgError = "";

                foreach (var reply in replies)
                {
                    try
                    {

                        if (string.IsNullOrWhiteSpace(reply.Phone))
                        {
                            _logger.LogWarning("No se pudo enviar respuesta {id}. No tiene teléfono.", reply.Id);

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
                Console.WriteLine("ERROR: " + ex.Message);
            }
            #endregion

            await Task.Delay(int.Parse(_configuration["Worker:IntervalSeconds"]!.ToString()), stoppingToken);
        }

    }

    private async Task EnsureWhatsAppGatewayIsRunningAsync()
    {
        if (await IsGatewayRunningAsync())
        {
            _logger.LogInformation("WhatsAppGateway ya está ejecutándose.");
            return;
        }

        _logger.LogWarning("WhatsAppGateway no responde. Intentando iniciarlo...");

        StartWhatsAppGateway();

        for (int i = 0; i < 200; i++)
        {
            await Task.Delay(3000);

            if (await IsGatewayRunningAsync())
            {
                _logger.LogInformation("WhatsAppGateway iniciado correctamente.");
                return;
            }
        }

        _logger.LogError("No se pudo iniciar WhatsAppGateway.");
    }

    private async Task<bool> IsGatewayRunningAsync()
    {
        try
        {
            var gatewayUrl = _configuration["WhatsAppGateway:Url"] ?? "http://localhost:3000";

            using var httpClient = new HttpClient
            {
                BaseAddress = new Uri(gatewayUrl),
                Timeout = TimeSpan.FromSeconds(3)
            };

            var response = await httpClient.GetAsync("/status");

            if (!response.IsSuccessStatusCode)
                return false;

            var gatewayStatus = await response.Content.ReadFromJsonAsync<GatewayStatusDto>();

            if (gatewayStatus?.User != null)
                _user = gatewayStatus.User;

            return true;
        }
        catch
        {
            return false;
        }
    }

    private void StartWhatsAppGateway()
    {
        if (!Directory.Exists(GatewayDirectory))
        {
            _logger.LogError("No se encontró la carpeta WhatsAppGateway en: {path}", GatewayDirectory);
            return;
        }
        try
        {
            var logPath = Path.Combine(GatewayDirectory, "gateway.log");

            var startInfo = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/C echo Iniciando Gateway... > \"{logPath}\" && npm start >> \"{logPath}\" 2>&1",
                WorkingDirectory = GatewayDirectory,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            Process.Start(startInfo);


            _logger.LogInformation("WhatsAppGateway iniciado con npm start. Ruta: {path}", GatewayDirectory);
            eventLog.WriteEntry("\"WhatsAppGateway iniciado con npm start.", EventLogEntryType.Information);
        }
        catch (Exception e)
        {
            eventLog.WriteEntry(e.Message, EventLogEntryType.Error);
            _logger.LogError("No se pudo iniciar WhatsAppGateway. Error: " + e.Message);
        }

    }
}
