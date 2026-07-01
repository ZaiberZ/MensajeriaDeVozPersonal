using AlexaSkillWhatsApp.Models;

namespace AlexaSkillWhatsApp.Utils
{
    public class ConversationStateHelper
    {
        public ConversationState GetState(AlexaRequest request)
        {
            return new ConversationState();
        }

        public Dictionary<string, object> ToSessionAttributes(ConversationState state)
        {
            return [];
        }
    }
}
