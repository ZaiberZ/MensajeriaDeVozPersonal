using AlexaSkillWhatsApp.Services;
using Shared.Models;

namespace VoiceMessaging.Worker.Services;

public class AirbnbMessageProcessor
{
    private readonly AirbnbService _airbnb;
    private readonly FirebaseService _firebase;
    private readonly ILogger _logger;
    private readonly Func<string, string, CancellationToken, Task> _registerWorkerLog;
    private readonly bool _gatewayEnabled;

    public AirbnbMessageProcessor(AirbnbService airbnb, FirebaseService firebase, ILogger logger, Func<string, string, CancellationToken, Task> registerWorkerLog, bool gatewayEnabled)
    {
        _airbnb = airbnb;
        _firebase = firebase;
        _logger = logger;
        _registerWorkerLog = registerWorkerLog;
        _gatewayEnabled = gatewayEnabled;
    }

    public async Task<bool> IsEnabledAsync(CancellationToken stoppingToken)
    {
        return _gatewayEnabled && await _firebase.IsAirbnbEnabledAsync(stoppingToken);
    }

    public async Task SaveNewMessagesAsync(CancellationToken stoppingToken)
    {
        var errors = "";

        try
        {
            var messages = await _airbnb.GetMessagesAsync(stoppingToken);

            if (messages.Count == 0)
                return;

            var firebaseMessages = await _firebase.GetAllMessagesAsync();
            var addedMessages = 0;

            foreach (var message in messages)
            {
                try
                {
                    var alreadyExists = firebaseMessages.Any(savedMessage =>
                        savedMessage.ChatId == message.ChatId &&
                        savedMessage.Text == message.Text &&
                        Math.Abs((savedMessage.Date - message.Date).TotalSeconds) <= 2);

                    if (alreadyExists)
                        continue;

                    var firebaseMessage = new MessageDto
                    {
                        ChatId = message.ChatId,
                        Phone = "",
                        Source = "Airbnb",
                        Account = "Airbnb",
                        Sender = message.Sender,
                        Text = message.Text,
                        Date = message.Date,
                        IsRead = false
                    };

                    await _firebase.SaveIncomingMessageAsync(firebaseMessage);
                    firebaseMessages.Add(firebaseMessage);
                    addedMessages++;
                    _logger.LogInformation("Mensaje de Airbnb guardado en Firebase: {sender} - {text}", firebaseMessage.Sender, firebaseMessage.Text);
                }
                catch (Exception ex)
                {
                    errors += ex.Message + " | ";
                }
            }

            if (addedMessages > 0)
                await _firebase.SetHasPendingMessagesAsync(true);
        }
        catch (Exception ex)
        {
            errors += ex.Message + " | ";
            _logger.LogError(ex, "Error guardando mensajes nuevos de Airbnb.");
            await _registerWorkerLog("error", $"Error guardando mensajes nuevos de Airbnb: {ex}", stoppingToken);
        }

    }

    public async Task SendReplyAsync(ReplyMessageDto reply, CancellationToken stoppingToken)
    {
        if (!await IsEnabledAsync(stoppingToken))
            throw new InvalidOperationException("Airbnb está deshabilitado; la respuesta permanecerá pendiente.");

        await _airbnb.SendReplyAsync(reply, stoppingToken);
    }
}
