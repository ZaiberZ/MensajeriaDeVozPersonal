using System.Text.Json;

namespace AlexaSkillWhatsApp.Models;

public class ConversationState
{
    public int CurrentMessageIndex { get; set; }

    public bool WaitingForReply { get; set; }

    public string CurrentMessageId { get; set; } = "";

    public string CurrentSender { get; set; } = "";
    public string CurrentAccount { get; set; } = "";

    public string ReplyText { get; set; } = "";
    public string CurrentSource { get; set; } = "";
    public string CurrentChatId { get; set; } = "";

    public string CurrentPhone { get; set; } = "";
    public string PendingUserPhone { get; set; } = "";
    public bool WaitingForPhoneConfirmation { get; set; }

    public static ConversationState FromSession(Dictionary<string, JsonElement>? attributes)
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

        if (attributes.TryGetValue(nameof(CurrentAccount), out var account))
            state.CurrentAccount = account.GetString() ?? "";

        if (attributes.TryGetValue(nameof(ReplyText), out var reply))
            state.ReplyText = reply.GetString() ?? "";

        if (attributes.TryGetValue(nameof(CurrentSource), out var source))
            state.CurrentSource = source.GetString() ?? "";

        if (attributes.TryGetValue(nameof(CurrentChatId), out var currentChatId))
            state.CurrentChatId = currentChatId.GetString() ?? "";

        if (attributes.TryGetValue(nameof(CurrentPhone), out var currentPhone))
            state.CurrentPhone = currentPhone.GetString() ?? "";

        if (attributes.TryGetValue(nameof(PendingUserPhone), out var pendingUserPhone))
            state.PendingUserPhone = pendingUserPhone.GetString() ?? "";

        if (attributes.TryGetValue(nameof(WaitingForPhoneConfirmation), out var waitingForPhoneConfirmation))
            state.WaitingForPhoneConfirmation = waitingForPhoneConfirmation.GetBoolean();

        return state;
    }

    public Dictionary<string, object> ToSessionAttributes()
    {
        return new()
        {
            { nameof(CurrentMessageIndex), CurrentMessageIndex },
            { nameof(WaitingForReply), WaitingForReply },
            { nameof(CurrentMessageId), CurrentMessageId },
            { nameof(CurrentSender), CurrentSender },
            { nameof(CurrentAccount), CurrentAccount },
            { nameof(ReplyText), ReplyText },
            { nameof(CurrentSource), CurrentSource },
            { nameof(CurrentChatId), CurrentChatId },
            { nameof(CurrentPhone), CurrentPhone },
            { nameof(PendingUserPhone), PendingUserPhone },
            { nameof(WaitingForPhoneConfirmation), WaitingForPhoneConfirmation },
        };
    }
}
