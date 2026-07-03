using AlexaSkillWhatsApp.Models;

namespace AlexaSkillWhatsApp.Utils
{
    public class ConversationStateHelper
    {
        public static ConversationState GetState(AlexaRequest request)
        {
            return new ConversationState();
        }

        public static Dictionary<string, object> ToSessionAttributes(ConversationState state)
        {
            return [];
        }
    }
}
