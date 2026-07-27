using System.Windows;

namespace VoiceInterpreter;

public partial class MainWindow : Window
{
    private readonly SpeechService speechService;

    public MainWindow(SpeechService speechService)
    {
        InitializeComponent();
        this.speechService = speechService;
    }

    private void TestSpeech_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            _ = speechService.CreateSpeechConfig();
            MessageBox.Show("SpeechConfig fue creado correctamente.", "Azure Speech", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception exception)
        {
            MessageBox.Show(exception.Message, "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }
}
