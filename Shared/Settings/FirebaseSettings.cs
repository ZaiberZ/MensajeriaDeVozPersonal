namespace Shared.Configuration;

public static class FirebaseSettings
{
    public const string BaseUrl = "https://voicemessaginghub-default-rtdb.firebaseio.com";

    public static string User(string userId) => $"{BaseUrl}/usuarios/{userId}";
    public static string PendingMessagesFor(string userId) => $"{User(userId)}/mensajes_pendientes";
    public static string OutgoingMessagesFor(string userId) => $"{User(userId)}/mensajes_por_enviar";
    public static string FrequentContactsFor(string userId) => $"{User(userId)}/contactos_frecuentes";
    public static string CommandsFor(string userId) => $"{User(userId)}/comandos";
    public static string StatusFor(string userId) => $"{User(userId)}/estado";
    public static string AlexaUser(string alexaUserKey) => $"{BaseUrl}/usuarios_alexa/{alexaUserKey}";
}
