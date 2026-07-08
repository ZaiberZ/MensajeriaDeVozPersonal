using System.Text.Json;

namespace AlexaSkillWhatsApp.Models;

public class ConversationState
{
    public int CurrentMessageIndex { get; set; }

    public bool WaitingForReply { get; set; }

    public bool WaitingForReplyConfirmation { get; set; }

    public string CurrentMessageId { get; set; } = "";

    public string CurrentConversationSpeech { get; set; } = "";

    public string CurrentSender { get; set; } = "";
    public string CurrentAccount { get; set; } = "";

    public string ReplyText { get; set; } = "";
    public string CurrentSource { get; set; } = "";
    public string CurrentChatId { get; set; } = "";

    public string CurrentPhone { get; set; } = "";
    public string PendingUserPhone { get; set; } = "";
    public bool WaitingForPhoneConfirmation { get; set; }
    public bool WaitingForContactMessage { get; set; }
    public string SelectedContactName { get; set; } = "";
    public string SelectedContactChatId { get; set; } = "";
    public string SelectedContactSource { get; set; } = "";
    public string SelectedContactPhone { get; set; } = "";
    public string PendingText { get; set; } = "";
    public bool WaitingForContactConfirmation { get; set; }

    public static ConversationState FromSession(Dictionary<string, JsonElement>? attributes)
    {
        if (attributes == null || attributes.Count == 0)
            return new ConversationState();

        var state = new ConversationState();

        if (attributes.TryGetValue(nameof(CurrentMessageIndex), out var index))
            state.CurrentMessageIndex = index.GetInt32();

        if (attributes.TryGetValue(nameof(WaitingForReply), out var waiting))
            state.WaitingForReply = waiting.GetBoolean();

        if (attributes.TryGetValue(nameof(WaitingForReplyConfirmation), out var waitingForReplyConfirmation))
            state.WaitingForReplyConfirmation = waitingForReplyConfirmation.GetBoolean();

        if (attributes.TryGetValue(nameof(CurrentMessageId), out var id))
            state.CurrentMessageId = id.GetString() ?? "";

        if (attributes.TryGetValue(nameof(CurrentConversationSpeech), out var currentConversationSpeech))
            state.CurrentConversationSpeech = currentConversationSpeech.GetString() ?? "";

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

        if (attributes.TryGetValue(nameof(WaitingForContactMessage), out var waitingForContactMessage))
            state.WaitingForContactMessage = waitingForContactMessage.GetBoolean();

        if (attributes.TryGetValue(nameof(SelectedContactName), out var selectedContactName))
            state.SelectedContactName = selectedContactName.GetString() ?? "";

        if (attributes.TryGetValue(nameof(SelectedContactChatId), out var selectedContactChatId))
            state.SelectedContactChatId = selectedContactChatId.GetString() ?? "";

        if (attributes.TryGetValue(nameof(SelectedContactSource), out var selectedContactSource))
            state.SelectedContactSource = selectedContactSource.GetString() ?? "";

        if (attributes.TryGetValue(nameof(SelectedContactPhone), out var selectedContactPhone))
            state.SelectedContactPhone = selectedContactPhone.GetString() ?? "";

        if (attributes.TryGetValue(nameof(PendingText), out var pendingText))
            state.PendingText = pendingText.GetString() ?? "";

        if (attributes.TryGetValue(nameof(WaitingForContactConfirmation), out var waitingForContactConfirmation))
            state.WaitingForContactConfirmation = waitingForContactConfirmation.GetBoolean();

        return state;
    }

    public Dictionary<string, object> ToSessionAttributes()
    {
        return new()
        {
            { nameof(CurrentMessageIndex), CurrentMessageIndex },
            { nameof(WaitingForReply), WaitingForReply },
            { nameof(WaitingForReplyConfirmation), WaitingForReplyConfirmation },
            { nameof(CurrentMessageId), CurrentMessageId },
            { nameof(CurrentConversationSpeech), CurrentConversationSpeech },
            { nameof(CurrentSender), CurrentSender },
            { nameof(CurrentAccount), CurrentAccount },
            { nameof(ReplyText), ReplyText },
            { nameof(CurrentSource), CurrentSource },
            { nameof(CurrentChatId), CurrentChatId },
            { nameof(CurrentPhone), CurrentPhone },
            { nameof(PendingUserPhone), PendingUserPhone },
            { nameof(WaitingForPhoneConfirmation), WaitingForPhoneConfirmation },
            { nameof(WaitingForContactMessage), WaitingForContactMessage },
            { nameof(SelectedContactName), SelectedContactName },
            { nameof(SelectedContactChatId), SelectedContactChatId },
            { nameof(SelectedContactSource), SelectedContactSource },
            { nameof(SelectedContactPhone), SelectedContactPhone },
            { nameof(PendingText), PendingText },
            { nameof(WaitingForContactConfirmation), WaitingForContactConfirmation },
        };
    }
}
