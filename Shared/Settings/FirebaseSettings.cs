namespace Shared.Configuration;

public static class FirebaseSettings
{
    public const string BaseUrl = "https://voicemessaginghub-default-rtdb.firebaseio.com";

    public const string UserId = "demo";
    public const string UserName = "Adrian";
    public static string User(string userId) => $"{BaseUrl}/usuarios/{userId}";
    public static string PendingMessagesFor(string userId) => $"{User(userId)}/mensajes_pendientes";
    public static string OutgoingMessagesFor(string userId) => $"{User(userId)}/mensajes_por_enviar";
    public static string CommandsFor(string userId) => $"{User(userId)}/comandos";
    public static string StatusFor(string userId) => $"{User(userId)}/estado";

    public static string PendingMessages => PendingMessagesFor(UserId);

    public static string OutgoingMessages => OutgoingMessagesFor(UserId);

    public static string Commands => CommandsFor(UserId);

    public static string Status => StatusFor(UserId);
}
