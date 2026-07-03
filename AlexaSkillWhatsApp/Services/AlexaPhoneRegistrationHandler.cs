using AlexaSkillWhatsApp.Helpers;
using AlexaSkillWhatsApp.Models;

namespace AlexaSkillWhatsApp.Services;

public class AlexaPhoneRegistrationHandler(AlexaUserPhoneService phoneService)
{
    public async Task<string?> TryHandleAsync(AlexaRequest request)
    {
        var intentName = request.Request.Intent?.Name;
        var state = ConversationState.FromSession(request.Session?.Attributes);

        if (intentName == "ConfigurarTelefonoIntent")
            return BeginRegistration(request, state);

        if (intentName == "ConfirmarIntent" && state.WaitingForPhoneConfirmation)
            return await ConfirmRegistrationAsync(request, state);

        if (intentName == "CancelarRespuestaIntent" && state.WaitingForPhoneConfirmation)
            return CancelRegistration(state);

        return null;
    }

    private static string BeginRegistration(AlexaRequest request, ConversationState state)
    {
        var slots = request.Request.Intent?.Slots;

        if (slots == null ||
            !slots.TryGetValue("telefono", out var slot) ||
            string.IsNullOrWhiteSpace(slot.Value))
        {
            return AlexaResponseFactory.Speak(
                "Dime el número que quieres utilizar, incluyendo la clave de país. Por ejemplo, configurar teléfono cinco dos uno cinco cinco cinco uno dos tres cuatro cinco seis siete.",
                state);
        }

        var phone = DigitsOnly(slot.Value);

        if (phone.Length is < 10 or > 15)
        {
            return AlexaResponseFactory.Speak(
                "El número debe tener entre diez y quince dígitos. Intenta decir configurar teléfono seguido del número completo.",
                state);
        }

        state.PendingUserPhone = phone;
        state.WaitingForPhoneConfirmation = true;

        return AlexaResponseFactory.Speak(
            $"El número que entendí es {ReadDigits(phone)}. ¿Es correcto?",
            state);
    }

    private async Task<string> ConfirmRegistrationAsync(
        AlexaRequest request,
        ConversationState state)
    {
        await phoneService.SavePhoneAsync(
            request.Session?.User.UserId ?? "",
            state.PendingUserPhone);

        var phone = state.PendingUserPhone;
        state.PendingUserPhone = "";
        state.WaitingForPhoneConfirmation = false;

        return AlexaResponseFactory.Speak(
            $"Listo. Guardé el número {ReadDigits(phone)}. Ya puedes consultar tus mensajes.",
            state);
    }

    private static string CancelRegistration(ConversationState state)
    {
        state.PendingUserPhone = "";
        state.WaitingForPhoneConfirmation = false;

        return AlexaResponseFactory.Speak(
            "Cancelé la configuración del teléfono. Puedes intentarlo nuevamente cuando quieras.",
            state);
    }

    private static string DigitsOnly(string value) =>
        new(value.Where(char.IsDigit).ToArray());

    private static string ReadDigits(string phone) =>
        string.Join(", ", phone.ToCharArray());
}
