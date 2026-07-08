namespace AlexaSkillWhatsApp.Models;

public class WorkerCommandDto
{
    public string Command { get; set; } = string.Empty;

    public DateTime Created { get; set; } = AlexaSkillWhatsApp.Services.AppClock.Now;
}
