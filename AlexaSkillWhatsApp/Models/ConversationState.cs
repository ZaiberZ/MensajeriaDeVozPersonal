using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace AlexaSkillWhatsApp.Models;

public class ConversationState
{
    public int CurrentMessageIndex { get; set; }

    public bool WaitingForReply { get; set; }

    public string CurrentMessageId { get; set; } = "";

    public string CurrentSender { get; set; } = "";

    public static ConversationState FromSession(        Dictionary<string, JsonElement>? attributes)
    {
        if (attributes == null || attributes.Count == 0)
            return new ConversationState();

        var state = new ConversationState();

        if (attributes.TryGetValue(nameof(CurrentMessageIndex), out var index))
            state.CurrentMessageIndex = index.GetInt32();

        if (attributes.TryGetValue(nameof(WaitingForReply), out var waiting))
            state.WaitingForReply = waiting.GetBoolean();

        if (attributes.TryGetValue(nameof(CurrentMessageId), out var id))
            state.CurrentMessageId = id.GetString() ?? "";

        if (attributes.TryGetValue(nameof(CurrentSender), out var sender))
            state.CurrentSender = sender.GetString() ?? "";

        return state;
    }

    public Dictionary<string, object> ToSessionAttributes()
    {
        return new()
        {
            { nameof(CurrentMessageIndex), CurrentMessageIndex },
            { nameof(WaitingForReply), WaitingForReply },
            { nameof(CurrentMessageId), CurrentMessageId },
            { nameof(CurrentSender), CurrentSender }
        };
    }
}