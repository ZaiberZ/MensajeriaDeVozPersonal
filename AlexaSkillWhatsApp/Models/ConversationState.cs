using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AlexaSkillWhatsApp.Models;

public class ConversationState
{
    public int CurrentMessageIndex { get; set; }

    public bool WaitingForReply { get; set; }

    public List<MessageDto> Messages { get; set; } = [];
}