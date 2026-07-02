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
        private readonly HttpClient _httpClient;

        public WhatsAppService(HttpClient http)
        {
            _httpClient = http;
        }

        public async Task SendMessageAsync(string phone, string text)
        {
            var request = new { phone, text };

            var response = await _httpClient.PostAsJsonAsync("/send", request);

            var body = await response.Content.ReadAsStringAsync();

            Console.WriteLine($"Status: {response.StatusCode}");
            Console.WriteLine(body);
        }

        public async Task<List<WhatsAppIncomingMessageDto>> GetMessagesAsync()
        {
            try
            {
                var messages = await _httpClient.GetFromJsonAsync<List<WhatsAppIncomingMessageDto>>("/messages");

                return messages ?? [];
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error al leer mensajes desde WhatsAppGateway:");
                Console.WriteLine(ex.Message);

                return [];
            }
        }
    }
}
