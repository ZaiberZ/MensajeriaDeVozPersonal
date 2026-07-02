using Shared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http.Json;
using System.Text;
using System.Threading.Tasks;

namespace VoiceMessaging.Worker.Services
{
    public class WhatsAppService
    {
        private readonly HttpClient _http;

        public WhatsAppService(HttpClient http)
        {
            _http = http;
        }

        public async Task SendMessageAsync(string phone, string text)
        {
            var request = new { phone, text };

            var response = await _http.PostAsJsonAsync("/send", request);

            var body = await response.Content.ReadAsStringAsync();

            Console.WriteLine($"Status: {response.StatusCode}");
            Console.WriteLine(body);
        }
    }
}
