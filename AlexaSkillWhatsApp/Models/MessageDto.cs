using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AlexaSkillWhatsApp.Models;

public class MessageDto
{
    public string Id { get; set; } = Guid.NewGuid().ToString();

    public string Source { get; set; } = "WhatsApp";

    public string Account { get; set; } = "Personal";

    public string Sender { get; set; } = "";

    public string Text { get; set; } = "";

    public bool IsAudio { get; set; }

    public string? AudioUrl { get; set; }

    public DateTime Date { get; set; } = DateTime.Now;
}