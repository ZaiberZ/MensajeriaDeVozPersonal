using AlexaSkillWhatsApp.Models;
using System.Text.Json;

namespace AlexaSkillWhatsApp.Helpers;

public static class AlexaResponseFactory
{
    public static string Speak(string speech, ConversationState? state = null)
    {
        var response = new
        {
            version = "1.0",
            sessionAttributes = state?.ToSessionAttributes() ?? new Dictionary<string, object>(),
            response = new
            {
                outputSpeech = new { type = "PlainText", text = speech },
                shouldEndSession = false
            }
        };

        return JsonSerializer.Serialize(response);
    }

    public static string EndConversation(string text, ConversationState? state = null)
    {
        var response = new AlexaResponse
        {
            Response = new ResponseBody
            {
                ShouldEndSession = true,
                OutputSpeech = new OutputSpeech
                {
                    Type = "PlainText",
                    Text = text
                }
            }
        };

        return JsonSerializer.Serialize(response);
    }
}
