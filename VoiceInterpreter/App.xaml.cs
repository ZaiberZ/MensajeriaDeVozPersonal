using System.Diagnostics;
using System.Windows;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace VoiceInterpreter;

public partial class App : Application
{
    private ServiceProvider? serviceProvider;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        IConfiguration configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false)
            .Build();

        AppSettings settings = new()
        {
            SpanishVoice = configuration["SpanishVoice"] ?? string.Empty,
            EnglishVoice = configuration["EnglishVoice"] ?? string.Empty,
            SpanishVoskModelPath = configuration["SpanishVoskModelPath"] ?? "Models/vosk-model-small-es-0.42"
        };

        ServiceCollection services = new();
        services.AddSingleton(settings);
        services.AddSingleton(new SemaphoreSlim(1, 1));
        services.AddSingleton<SpeechService>();
        services.AddSingleton<SpeechRecognitionService>();
        services.AddSingleton<MainWindow>();

        serviceProvider = services.BuildServiceProvider();
        SpeechService speechService = serviceProvider.GetRequiredService<SpeechService>();

        Debug.WriteLine("Voces instaladas:");
        foreach (string voice in speechService.GetInstalledVoices())
        {
            Debug.WriteLine($"- {voice}");
        }

        serviceProvider.GetRequiredService<MainWindow>().Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        serviceProvider?.Dispose();
        base.OnExit(e);
    }
}
