using Shared.Models;

namespace AlexaSkillWhatsApp.Configuration;

public static class LambdaUserConfiguration
{
    private const string PhoneVariable = "VOICE_MESSAGING_PHONE";
    private const string FullNameVariable = "VOICE_MESSAGING_FULL_NAME";
    private const string EmailVariable = "VOICE_MESSAGING_EMAIL";

    public static UserDto? GetUser()
    {
        var phone = Environment.GetEnvironmentVariable(PhoneVariable);

        if (string.IsNullOrWhiteSpace(phone))
            return null;

        return new UserDto
        {
            Phone = phone,
            FullName = Environment.GetEnvironmentVariable(FullNameVariable) ?? "",
            Email = Environment.GetEnvironmentVariable(EmailVariable) ?? "",
            IsRegistered = true
        };
    }
}
