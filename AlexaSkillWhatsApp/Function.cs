using Amazon.Lambda.Core;
using System.Text.Json;

// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace AlexaSkillWhatsApp;

public class Function
{
    public string FunctionHandler(JsonElement input, ILambdaContext context)
    {
        context.Logger.LogLine(input.ToString());

        return """
        {
          "version":"1.0",
          "response":{
            "outputSpeech":{
              "type":"PlainText",
              "text":"Hola, esta es mi primera respuesta."
            },
            "shouldEndSession":false
          }
        }
        """;
    }
}
