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
                                Source = message.Source,
                                Account = message.Account,
                                Sender = message.Sender,
                                Text = message.Text,
                                Date = message.Date,
                                Phone = message.Phone,
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

                await Task.Delay(1000, stoppingToken);
            }

        }
    }
}
