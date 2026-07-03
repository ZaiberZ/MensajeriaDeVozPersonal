using AlexaSkillWhatsApp.Services;
using Shared.Models;
using VoiceMessaging.Worker.Services;
using System.Diagnostics;
using System.Net.Http.Json;

namespace VoiceMessaging.Worker;

public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly IConfiguration _configuration;
    private static readonly string GatewayDirectory = Path.Combine(AppContext.BaseDirectory, "WhatsAppGateway");

    public Worker(ILogger<Worker> logger, IConfiguration configuration)
    {
        _logger = logger;
        _configuration = configuration;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await EnsureWhatsAppGatewayIsRunningAsync();

        var client = new HttpClient { BaseAddress = new Uri(_configuration["WhatsAppGateway:Url"]!) };
        var whatsApp = new WhatsAppService(client);
        var firebase = new FirebaseService();
        string msgError;
        // await whatsApp.SendMessageAsync("5217731542880", "Hola desde el Worker");

        while (!stoppingToken.IsCancellationRequested)
        {
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

        for (int i = 0; i < 10; i++)
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

            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private void StartWhatsAppGateway()
    {
        var command = _configuration["WhatsAppGateway:Command"] ?? "node";
        var arguments = _configuration["WhatsAppGateway:Arguments"] ?? "app.js";

        if (string.IsNullOrWhiteSpace(GatewayDirectory))
        {
            _logger.LogError("WhatsAppGateway:Path no está configurado.");
            return;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = "node",
            Arguments = "app.js",
            WorkingDirectory = GatewayDirectory,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        Process.Start(startInfo);

        _logger.LogInformation("Proceso WhatsAppGateway iniciado.");
    }
}
