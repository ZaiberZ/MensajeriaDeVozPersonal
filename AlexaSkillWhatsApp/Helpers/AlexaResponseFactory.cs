using AlexaSkillWhatsApp.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace AlexaSkillWhatsApp.Helpers;

public static class AlexaResponseFactory
{
    public static string Speak(string text)
    {
        var response = new AlexaResponse
        {
            Response = new ResponseBody
            {
                ShouldEndSession = false,
                OutputSpeech = new OutputSpeech
                {
                    Type = "PlainText",
                    Text = text
                }
            }
        };

        return JsonSerializer.Serialize(response);
    }

    public static string EndConversation(string text)
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
