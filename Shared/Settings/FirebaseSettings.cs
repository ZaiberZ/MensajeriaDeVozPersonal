namespace Shared.Configuration;

public static class FirebaseSettings
{
    public static string BaseUrl => GetRequiredEnvironmentVariable("VOICE_MESSAGING_FIREBASE_URL").TrimEnd('/');

    public static string User(string userId) => $"{BaseUrl}/usuarios/{userId}";
    public static string PendingMessagesFor(string userId) => $"{User(userId)}/mensajes_pendientes";
    public static string OutgoingMessagesFor(string userId) => $"{User(userId)}/mensajes_por_enviar";
    public static string FrequentContactsFor(string userId) => $"{User(userId)}/contactos_frecuentes";
    public static string CommandsFor(string userId) => $"{User(userId)}/comandos";
    public static string StatusFor(string userId) => $"{User(userId)}/estado";
    public static string AlexaUser(string alexaUserKey) => $"{BaseUrl}/usuarios_alexa/{alexaUserKey}";

    private static string GetRequiredEnvironmentVariable(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);

        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException($"Falta la variable de entorno requerida {name}.");

        return value;
    }
}
