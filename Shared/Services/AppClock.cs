namespace AlexaSkillWhatsApp.Services;

public static class AppClock
{
    private const string DefaultTimeZoneId = "America/Mexico_City";
    private const string EnvironmentVariableName = "VOICE_MESSAGING_TIME_ZONE";
    private static TimeZoneInfo timeZone = ResolveTimeZone(Environment.GetEnvironmentVariable(EnvironmentVariableName) ?? DefaultTimeZoneId);

    public static DateTime Now => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timeZone).DateTime;
    public static string TimeZoneId => timeZone.Id;

    public static void Configure(string? timeZoneId)
    {
        timeZone = ResolveTimeZone(string.IsNullOrWhiteSpace(timeZoneId)
            ? Environment.GetEnvironmentVariable(EnvironmentVariableName) ?? DefaultTimeZoneId
            : timeZoneId);
    }

    private static TimeZoneInfo ResolveTimeZone(string timeZoneId)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException) when (string.Equals(timeZoneId, DefaultTimeZoneId, StringComparison.OrdinalIgnoreCase))
        {
            return TimeZoneInfo.CreateCustomTimeZone(DefaultTimeZoneId, TimeSpan.FromHours(-6), "Mexico City", "Mexico City");
        }
        catch (InvalidTimeZoneException) when (string.Equals(timeZoneId, DefaultTimeZoneId, StringComparison.OrdinalIgnoreCase))
        {
            return TimeZoneInfo.CreateCustomTimeZone(DefaultTimeZoneId, TimeSpan.FromHours(-6), "Mexico City", "Mexico City");
        }
    }
}
