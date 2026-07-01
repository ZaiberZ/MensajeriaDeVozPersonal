using AlexaSkillWhatsApp.Models;
using AlexaSkillWhatsApp.Services;
using Amazon.Lambda.Core;
using System.Text.Json;

// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace AlexaSkillWhatsApp;

public class Function
{
    public string FunctionHandler(JsonElement input, ILambdaContext context)
    {
        // context.Logger.LogLine(input.ToString());
        // context.Logger.LogLine(input.GetRawText());

        var request = JsonSerializer.Deserialize<AlexaRequest>(input.GetRawText())!;

        // context.Logger.LogLine($"Tipo: {request.Request.Type}");
        // context.Logger.LogLine($"Intent: {request.Request.Intent?.Name}");

        if (request == null)
        {
            return Helpers.AlexaResponseFactory.Speak("Ocurrió un error.");
        }

        return AlexaRequestRouter.Process(request);
    }
}
