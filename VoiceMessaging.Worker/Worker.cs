using AlexaSkillWhatsApp.Services;
using Shared.Models;
using VoiceMessaging.Worker.Services;

namespace VoiceMessaging.Worker
{
    public class Worker : BackgroundService
    {
        private readonly ILogger<Worker> _logger;

        public Worker(ILogger<Worker> logger)
        {
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var client = new HttpClient { BaseAddress = new Uri("http://localhost:3000") };
            var whatsApp = new WhatsAppService(client);
            var firebase = new FirebaseService();

            // await whatsApp.SendMessageAsync("5217731542880", "Hola desde el Worker");

            while (!stoppingToken.IsCancellationRequested)
            {
                var messages = await whatsApp.GetMessagesAsync();

                foreach (var message in messages)
                {
                    var firebaseMessage = new MessageDto
                    {
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

                await Task.Delay(1000, stoppingToken);
            }

        }
    }
}
