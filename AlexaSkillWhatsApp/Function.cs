using AlexaSkillWhatsApp.Configuration;
using AlexaSkillWhatsApp.Models;
using AlexaSkillWhatsApp.Services;
using Amazon.Lambda.Core;
using Shared.Models;
using System.Text.Json;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace AlexaSkillWhatsApp;

public class Function
{
    public static async Task<string> FunctionHandler(JsonElement input, ILambdaContext context)
    {
        var request = JsonSerializer.Deserialize<AlexaRequest>(input.GetRawText());

        if (request == null)
            return Helpers.AlexaResponseFactory.Speak("Ocurrió un error.");

        context.Logger.LogLine($"Intent: {request.Request.Intent?.Name}");
        var fallbackUser = LambdaUserConfiguration.GetUser();
        UserDto? user = fallbackUser;

        try
        {
            var alexaUserId = request.Session?.User.UserId ?? "";
            var phoneService = new AlexaUserPhoneService();
            var registrationHandler = new AlexaPhoneRegistrationHandler(phoneService);
            var registrationResponse = await registrationHandler.TryHandleAsync(request);

            if (registrationResponse != null)
                return registrationResponse;

            var savedPhone = await phoneService.GetPhoneAsync(alexaUserId);

            if (!string.IsNullOrWhiteSpace(savedPhone))
            {
                user = new UserDto
                {
                    Phone = savedPhone,
                    IsRegistered = true
                };
            }

            if (user == null)
                return Helpers.AlexaResponseFactory.Speak("Aún no tienes un teléfono configurado. Di configurar teléfono seguido de tu número completo.");

            var router = new AlexaRequestRouter(context, user);
            return await router.Process(request);
        }
        catch (Exception ex) when (IsFirebaseConnectionProblem(ex))
        {
            context.Logger.LogLine($"Problema de conexión con Firebase: {ex}");
            await TrySaveFirebaseConnectionLogAsync(user, request, ex, context);
            return Helpers.AlexaResponseFactory.Speak("Tengo problemas para conectarme con Firebase. No pude completar la operación. Inténtalo nuevamente en unos momentos.");
        }
    }

    private static bool IsFirebaseConnectionProblem(Exception exception)
    {
        return exception is HttpRequestException or TaskCanceledException ||
            exception.InnerException != null && IsFirebaseConnectionProblem(exception.InnerException);
    }

    private static async Task TrySaveFirebaseConnectionLogAsync(UserDto? user, AlexaRequest request, Exception exception, ILambdaContext context)
    {
        if (user == null || string.IsNullOrWhiteSpace(user.Phone))
        {
            context.Logger.LogLine("No se pudo guardar el problema en Firebase porque todavía no se conoce el teléfono del usuario.");
            return;
        }

        var log = new DiagnosticLogDto
        {
            Timestamp = AppClock.Now,
            Message = "Problema de conexión con Firebase durante una operación de Alexa.",
            Detail = Truncate(exception.ToString(), 4000),
            Operation = request.Request.Intent?.Name ?? request.Request.Type
        };
        var firebase = new FirebaseService(user);

        // Firebase puede estar recuperándose; se hacen intentos breves antes de conservar solo CloudWatch.
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                await firebase.SaveDiagnosticLogAsync(log);
                context.Logger.LogLine("El problema de conexión quedó registrado en diagnosticos/logs de Firebase.");
                return;
            }
            catch (Exception logException) when (IsFirebaseConnectionProblem(logException) && attempt < 3)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(250 * attempt));
            }
            catch (Exception logException)
            {
                context.Logger.LogLine($"No se pudo guardar el log en Firebase; se conserva en CloudWatch: {logException}");
                return;
            }
        }
    }

    private static string Truncate(string value, int maxLength) => value.Length <= maxLength ? value : value[..maxLength];
}
