using System.Diagnostics;
using System.Windows;

namespace VoiceInterpreter;

public partial class MainWindow : Window
{
    private readonly SpeechService speechService;

    public MainWindow(SpeechService speechService)
    {
        InitializeComponent();
        this.speechService = speechService;
        UpdateVoiceInstallationButtons();
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        UpdateVoiceInstallationButtons();
    }

    private async void TestSpanish_Click(object sender, RoutedEventArgs e)
    {
        await RunVoiceTestAsync("El intérprete de voz está funcionando correctamente.", "es");
    }

    private async void TestEnglish_Click(object sender, RoutedEventArgs e)
    {
        await RunVoiceTestAsync("The voice interpreter is working correctly.", "en");
    }

    private void OpenVoiceSettings_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Process.Start(new ProcessStartInfo("ms-settings:speech")
            {
                UseShellExecute = true
            });
        }
        catch (Exception exception)
        {
            MessageBox.Show($"No se pudo abrir la configuración de voz de Windows.{Environment.NewLine}{Environment.NewLine}{exception.Message}",
                "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void UpdateVoiceInstallationButtons()
    {
        InstallSpanishVoiceButton.Visibility = speechService.HasInstalledVoice("es") ? Visibility.Collapsed : Visibility.Visible;
        InstallEnglishVoiceButton.Visibility = speechService.HasInstalledVoice("en") ? Visibility.Collapsed : Visibility.Visible;
    }

    private async Task RunVoiceTestAsync(string text, string language)
    {
        TestSpanishButton.IsEnabled = false;
        TestEnglishButton.IsEnabled = false;

        try
        {
            await speechService.SpeakAsync(text, language);
        }
        catch (Exception exception)
        {
            MessageBox.Show($"No se pudo reproducir la prueba de voz.{Environment.NewLine}{Environment.NewLine}{exception.Message}",
                "Error de voz local", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            TestSpanishButton.IsEnabled = true;
            TestEnglishButton.IsEnabled = true;
        }
    }
}
