using AlexaSkillWhatsApp.Services;

namespace VoiceMessaging.Worker.Services;

public class PendingReplyProcessor
{
    private readonly WhatsAppMessageProcessor _whatsAppProcessor;
    private readonly AirbnbMessageProcessor _airbnbProcessor;
    private readonly FirebaseService _firebase;
    private readonly ILogger _logger;
    private readonly Func<string, string, string?, CancellationToken, Task> _registerWorkerLog;

    public PendingReplyProcessor(WhatsAppMessageProcessor whatsAppProcessor, AirbnbMessageProcessor airbnbProcessor, FirebaseService firebase, ILogger logger, Func<string, string, string?, CancellationToken, Task> registerWorkerLog)
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
                    var sent = false;
                    var confirmationId = "";

                    if (string.Equals(reply.Source, "AirbnbEmail", StringComparison.OrdinalIgnoreCase))
                    {
                        _logger.LogWarning("AirbnbEmail replies are not supported yet.");
                        await _registerWorkerLog("warning", "AirbnbEmail replies are not supported yet.", null, stoppingToken);
                        allRepliesProcessed = false;
                        continue;
                    }
                    else if (string.Equals(reply.Source, "Airbnb", StringComparison.OrdinalIgnoreCase))
                    {
                        await _airbnbProcessor.SendReplyAsync(reply, stoppingToken);
                        confirmationId = $"airbnb-{reply.Id}";
                        sent = true;
                    }
                    else if (string.IsNullOrWhiteSpace(reply.Phone))
                    {
                        _logger.LogWarning("No se pudo enviar respuesta {id}. No tiene teléfono.", reply.Sender);
                        await _registerWorkerLog("warning", $"No se pudo enviar la respuesta de {reply.Sender}. No tiene teléfono.", null, stoppingToken);
                        allRepliesProcessed = false;
                        continue;
                    }
                    else
                    {
                        // No se toca este pendiente mientras WhatsApp no esté listo.
                        if (!await _whatsAppProcessor.IsConnectedAsync(stoppingToken))
                        {
                            allRepliesProcessed = false;
                            _logger.LogDebug("La respuesta pendiente {replyId} esperará a que WhatsApp esté conectado.", reply.Id);
                            continue;
                        }

                        // Firebase conserva la respuesta hasta que el gateway devuelve el id real del mensaje.
                        confirmationId = await _whatsAppProcessor.SendReplyAsync(reply, stoppingToken);
                        sent = true;
                        _logger.LogInformation("WhatsApp confirmó la respuesta pendiente {replyId} con el mensaje {messageId}.", reply.Id, confirmationId);
                    }

                    if (!sent)
                    {
                        allRepliesProcessed = false;
                        continue;
                    }

                    var confirmedAt = AppClock.Now;
                    await TryRegisterLastSentMessageAsync(reply, confirmationId, confirmedAt, stoppingToken);
                    var deliveryReceiptSaved = await TrySaveAlexaDeliveryReceiptAsync(reply, confirmationId, confirmedAt, stoppingToken);
                    await _firebase.DeleteReplyAsync(reply.Id);

                    // La confirmación real de entrega permite retirar el diagnóstico de esta sesión de Alexa.
                    if (!string.IsNullOrWhiteSpace(reply.AlexaWriteTraceId) && deliveryReceiptSaved)
                    {
                        try
                        {
                            await _firebase.DeleteAlexaWriteTraceAsync(reply.AlexaWriteTraceId, stoppingToken);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "El mensaje fue confirmado, pero no se pudo eliminar el seguimiento de Alexa {traceId}.", reply.AlexaWriteTraceId);
                        }
                    }

                    _logger.LogInformation("Respuesta confirmada y eliminada de pendientes en Firebase: {sender} - {text}", reply.Sender, reply.Text);
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
            await _registerWorkerLog("error", "Error enviando respuestas pendientes.", ex.ToString(), stoppingToken);
        }

    }

    private async Task TryRegisterLastSentMessageAsync(Shared.Models.ReplyMessageDto reply, string confirmationId, DateTime confirmedAt, CancellationToken stoppingToken)
    {
        try
        {
            await _firebase.RegisterLastSentMessageAsync(reply, confirmationId, confirmedAt, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // El ACK real ya existe; un fallo del registro auxiliar no debe bloquear la cola.
            _logger.LogWarning(ex, "El mensaje {replyId} fue confirmado, pero no se pudo actualizar last_sent_message.", reply.Id);
        }
    }

    private async Task<bool> TrySaveAlexaDeliveryReceiptAsync(Shared.Models.ReplyMessageDto reply, string confirmationId, DateTime confirmedAt, CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(reply.AlexaWriteTraceId) || !string.Equals(reply.Source, "WhatsApp", StringComparison.OrdinalIgnoreCase))
            return true;

        try
        {
            // Se conserva el texto enviado y la evidencia del ACK durante tres días, sin los turnos completos.
            await _firebase.SaveAlexaDeliveryReceiptAsync(reply.AlexaWriteTraceId, new Shared.Models.AlexaDeliveryReceiptDto
            {
                Operation = string.IsNullOrWhiteSpace(reply.MessageId) ? "new_message" : "reply",
                Recipient = reply.Sender,
                Text = reply.Text,
                WhatsAppMessageId = confirmationId,
                ConfirmedAt = confirmedAt,
                MinimumAck = 1,
                AckMeaning = "server_received",
                ReplyId = reply.Id
            }, stoppingToken);
            return true;
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // El comprobante es diagnóstico y nunca debe impedir eliminar un pendiente ya confirmado.
            _logger.LogWarning(ex, "El mensaje {replyId} fue confirmado, pero no se pudo guardar su comprobante de Alexa.", reply.Id);
            return false;
        }
    }
}
