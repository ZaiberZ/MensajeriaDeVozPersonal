using System.Text.Json.Serialization;

namespace AlexaSkillWhatsApp.Models
{
    public class AlexaResponse
    {
        [JsonPropertyName("version")]
        public string Version { get; set; } = "1.0";

        [JsonPropertyName("response")]
        public ResponseBody Response { get; set; } = new();
    }

    public class ResponseBody
    {
        [JsonPropertyName("outputSpeech")]
        public OutputSpeech OutputSpeech { get; set; } = new();

        [JsonPropertyName("shouldEndSession")]
        public bool ShouldEndSession { get; set; }
    }

    public class OutputSpeech
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "PlainText";

        [JsonPropertyName("text")]
        public string Text { get; set; } = "";
    }
}
