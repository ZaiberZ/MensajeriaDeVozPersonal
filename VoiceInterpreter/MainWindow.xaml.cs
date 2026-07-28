using System.Diagnostics;
using System.Windows;

namespace VoiceInterpreter;

public partial class MainWindow : Window
{
    private readonly SpeechService speechService;
    private readonly SpeechRecognitionService speechRecognitionService;

    public MainWindow(SpeechService speechService, SpeechRecognitionService speechRecognitionService)
    {
        InitializeComponent();
        this.speechService = speechService;
        this.speechRecognitionService = speechRecognitionService;
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

    private async void TestMicrophone_Click(object sender, RoutedEventArgs e)
    {
        SetTestButtonsEnabled(false);
        RecognizedTextBlock.Text = string.Empty;

        try
        {
            await speechService.SpeakAsync("Después del sonido, diga una frase en español.", "es");
            System.Media.SystemSounds.Beep.Play();

            string? recognizedText = await speechRecognitionService.RecognizeSpanishOnceAsync();
            if (string.IsNullOrWhiteSpace(recognizedText))
            {
                await speechService.SpeakAsync("No pude entender la frase. Intente nuevamente.", "es");
                return;
            }

            RecognizedTextBlock.Text = recognizedText;
            Debug.WriteLine($"Texto reconocido: {recognizedText}");
            await speechService.SpeakAsync($"Escuché: {recognizedText}", "es");
        }
        catch (Exception exception)
        {
            MessageBox.Show($"No se pudo completar la prueba del micrófono.{Environment.NewLine}{Environment.NewLine}{exception.Message}",
                "Error de reconocimiento local", MessageBoxButton.OK, MessageBoxImage.Error);

            try
            {
                await speechService.SpeakAsync("Ocurrió un problema con el micrófono.", "es");
            }
            catch (Exception speechException)
            {
                Debug.WriteLine($"No se pudo anunciar el error: {speechException.Message}");
            }
        }
        finally
        {
            SetTestButtonsEnabled(true);
        }
    }

    private async void DownloadSpanishModel_Click(object sender, RoutedEventArgs e)
    {
        DownloadSpanishModelButton.IsEnabled = false;
        ModelDownloadProgressBar.Value = 0;
        ModelDownloadProgressBar.Visibility = Visibility.Visible;
        Progress<double> progress = new(value => ModelDownloadProgressBar.Value = value);

        try
        {
            await speechRecognitionService.DownloadSpanishModelAsync(progress);
            UpdateModelControls();
        }
        catch (Exception exception)
        {
            MessageBox.Show($"No se pudo descargar el modelo de español.{Environment.NewLine}{Environment.NewLine}{exception.Message}",
                "Error de configuración", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            DownloadSpanishModelButton.IsEnabled = true;
            ModelDownloadProgressBar.Visibility = Visibility.Collapsed;
        }
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
        UpdateModelControls();
    }

    private void UpdateModelControls()
    {
        bool modelInstalled = speechRecognitionService.IsSpanishModelInstalled();
        DownloadSpanishModelButton.Visibility = modelInstalled ? Visibility.Collapsed : Visibility.Visible;
        TestMicrophoneButton.IsEnabled = modelInstalled;
    }

    private async Task RunVoiceTestAsync(string text, string language)
    {
        SetTestButtonsEnabled(false);

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
            SetTestButtonsEnabled(true);
        }
    }

    private void SetTestButtonsEnabled(bool isEnabled)
    {
        TestSpanishButton.IsEnabled = isEnabled;
        TestEnglishButton.IsEnabled = isEnabled;
        TestMicrophoneButton.IsEnabled = isEnabled && speechRecognitionService.IsSpanishModelInstalled();
    }
}
