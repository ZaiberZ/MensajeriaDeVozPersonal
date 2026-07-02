namespace Shared.Configuration;

public static class FirebaseSettings
{
    public const string BaseUrl = "https://voicemessaginghub-default-rtdb.firebaseio.com";

    public const string UserId = "demo";
    public const string UserName = "Adrian";
    public static string PendingMessages => $"{BaseUrl}/usuarios/{UserId}/mensajes_pendientes";

    public static string OutgoingMessages => $"{BaseUrl}/usuarios/{UserId}/mensajes_por_enviar";

    public static string Commands => $"{BaseUrl}/usuarios/{UserId}/comandos";

    public static string Status => $"{BaseUrl}/usuarios/{UserId}/estado";
}