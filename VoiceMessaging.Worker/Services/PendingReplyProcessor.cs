using AlexaSkillWhatsApp.Services;

namespace VoiceMessaging.Worker.Services;

public class PendingReplyProcessor
{
    private readonly WhatsAppMessageProcessor _whatsAppProcessor;
    private readonly AirbnbMessageProcessor _airbnbProcessor;
    private readonly FirebaseService _firebase;
    private readonly ILogger _logger;
    private readonly Func<string, string, CancellationToken, Task> _registerWorkerLog;

    public PendingReplyProcessor(WhatsAppMessageProcessor whatsAppProcessor, AirbnbMessageProcessor airbnbProcessor, FirebaseService firebase, ILogger logger, Func<string, string, CancellationToken, Task> registerWorkerLog)
    {
        _whatsAppProcessor = whatsAppProcessor;
        _airbnbProcessor = airbnbProcessor;
        _firebase = firebase;
        _logger = logger;
        _registerWorkerLog = registerWorkerLog;
    }

    public async Task ProcessAsync(bool hasPendingReplies, CancellationToken stoppingToken)
    {
        var errors = "";

        try
        {
            if (!hasPendingReplies)
                return;

            var replies = await _firebase.GetPendingRepliesAsync();
            var allRepliesProcessed = true;

            foreach (var reply in replies)
            {
                try
                {
                    if (string.Equals(reply.Source, "AirbnbEmail", StringComparison.OrdinalIgnoreCase))
                    {
                        _logger.LogWarning("AirbnbEmail replies are not supported yet.");
                        await _registerWorkerLog("warning", "AirbnbEmail replies are not supported yet.", stoppingToken);
                    }
                    else if (string.Equals(reply.Source, "Airbnb", StringComparison.OrdinalIgnoreCase))
                    {
                        await _airbnbProcessor.SendReplyAsync(reply, stoppingToken);
                    }
                    else if (string.IsNullOrWhiteSpace(reply.Phone))
                    {
                        _logger.LogWarning("No se pudo enviar respuesta {id}. No tiene teléfono.", reply.Sender);
                        await _registerWorkerLog("warning", $"No se pudo enviar la respuesta de {reply.Sender}. No tiene teléfono.", stoppingToken);
                        allRepliesProcessed = false;
                        continue;
                    }
                    else
                    {
                        await _whatsAppProcessor.SendReplyAsync(reply);
                    }

                    await _firebase.DeleteReplyAsync(reply.Id);
                    _logger.LogInformation("Respuesta procesada y eliminada de Firebase: {sender} - {text}", reply.Sender, reply.Text);
                }
                catch (Exception ex)
                {
                    allRepliesProcessed = false;
                    errors += ex.Message + " | ";
                }
            }

            if (!string.IsNullOrEmpty(errors))
                throw new Exception(errors);

            if (allRepliesProcessed)
                await _firebase.SetHasPendingRepliesAsync(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error enviando respuestas pendientes.");
            await _registerWorkerLog("error", $"Error enviando respuestas pendientes: {ex}", stoppingToken);
        }

    }
}
