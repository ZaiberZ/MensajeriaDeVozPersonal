using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Windows;

namespace VoiceInterpreter;

public partial class MainWindow : Window
{
    private readonly SpeechService speechService;
    private readonly SpeechRecognitionService speechRecognitionService;
    private readonly TranslationService translationService;
    private CancellationTokenSource? commandListeningCancellation;
    private CancellationTokenSource? translationSetupCancellation;
    private Task? commandSessionTask;
    private Task<TranslationStatus>? translationSetupTask;
    private volatile InterpreterState interpreterState = InterpreterState.Inactive;
    private string? LastTranslatedText { get; set; }
    private string? LastTranslationLanguage { get; set; }
    private bool allowClose;

    public MainWindow(
        SpeechService speechService,
        SpeechRecognitionService speechRecognitionService,
        TranslationService translationService)
    {
        InitializeComponent();
        this.speechService = speechService;
        this.speechRecognitionService = speechRecognitionService;
        this.translationService = translationService;
        UpdateVoiceInstallationButtons();
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        UpdateVoiceInstallationButtons();
    }

    protected override async void OnClosing(CancelEventArgs e)
    {
        if (allowClose || (commandSessionTask is null && translationSetupTask is null))
        {
            base.OnClosing(e);
            return;
        }

        e.Cancel = true;
        commandListeningCancellation?.Cancel();
        translationSetupCancellation?.Cancel();

        try
        {
            await Task.WhenAll(
                commandSessionTask ?? Task.CompletedTask,
                translationSetupTask ?? Task.CompletedTask);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            Debug.WriteLine($"Error al cerrar la sesión de escucha: {exception}");
        }

        allowClose = true;
        Close();
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
            await ReportRecognitionErrorAsync(exception, "No se pudo completar la prueba del micrófono.");
        }
        finally
        {
            SetTestButtonsEnabled(true);
        }
    }

    private async void StartCommandListening_Click(object sender, RoutedEventArgs e)
    {
        if (!speechRecognitionService.IsSpanishModelInstalled())
        {
            MessageBox.Show($"Falta el modelo de español en:{Environment.NewLine}{speechRecognitionService.GetSpanishModelPath()}",
                "Modelo no instalado", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        commandListeningCancellation = new CancellationTokenSource();
        SetListeningControls(isListening: true);
        commandSessionTask = RunCommandSessionAsync(commandListeningCancellation.Token);

        try
        {
            await commandSessionTask;
        }
        catch (OperationCanceledException) when (commandListeningCancellation.IsCancellationRequested)
        {
            Debug.WriteLine("La sesión de control por voz fue cancelada.");
        }
        catch (Exception exception)
        {
            await ReportRecognitionErrorAsync(exception, "Se detuvo la escucha de comandos.");
        }
        finally
        {
            commandListeningCancellation.Dispose();
            commandListeningCancellation = null;
            commandSessionTask = null;
            SetListeningControls(isListening: false);
        }
    }

    private async void StopCommandListening_Click(object sender, RoutedEventArgs e)
    {
        CancellationTokenSource? cancellation = commandListeningCancellation;
        Task? session = commandSessionTask;
        if (cancellation is null)
        {
            return;
        }

        StopCommandListeningButton.IsEnabled = false;
        cancellation.Cancel();

        try
        {
            if (session is not null)
            {
                await session;
            }
        }
        catch (OperationCanceledException)
        {
        }

        await speechService.SpeakAsync("Control por voz desactivado.", "es");
    }

    private async Task RunCommandSessionAsync(CancellationToken cancellationToken)
    {
        Debug.WriteLine("Iniciando sesión de control por voz.");
        await speechService.SpeakAsync(
            "Control por voz activado. Puede decir ayuda para conocer los comandos.", "es", cancellationToken);
        await speechRecognitionService.ListenContinuouslyAsync(
            HandleRecognizedTextAsync,
            () => interpreterState,
            cancellationToken);
    }

    private async Task HandleRecognizedTextAsync(string recognizedText)
    {
        string command = NormalizeCommand(recognizedText);
        await Dispatcher.InvokeAsync(() => LastCommandTextBlock.Text = $"Último texto reconocido: {recognizedText}");

        if (interpreterState == InterpreterState.ListeningSpanish)
        {
            await HandleSpanishConversationTextAsync(recognizedText, command);
            return;
        }

        if (interpreterState == InterpreterState.ListeningEnglish)
        {
            await HandleEnglishConversationTextAsync(recognizedText, command);
            return;
        }

        Debug.WriteLine($"Comando reconocido: {recognizedText} (normalizado: {command})");

        CancellationToken cancellationToken = commandListeningCancellation?.Token ?? CancellationToken.None;

        switch (command)
        {
            case "iniciar interprete":
            case "inicia el interprete":
            case "inicia interprete":
                if (!speechRecognitionService.IsEnglishModelInstalled())
                {
                    await speechService.SpeakAsync("El modelo de inglés no está instalado.", "es", cancellationToken);
                    break;
                }

                TranslationStatus status = await translationService.CheckInstallationAsync(cancellationToken);
                await Dispatcher.InvokeAsync(() => UpdateTranslationStatus(status));
                if (!status.IsReady)
                {
                    await speechService.SpeakAsync(
                        "La traducción local todavía no está configurada.", "es", cancellationToken);
                    break;
                }

                await SetInterpreterStateAsync(InterpreterState.ListeningSpanish);
                await speechService.SpeakAsync("Puede comenzar a hablar en español.", "es", cancellationToken);
                break;

            case "repetir":
            case "repite":
            case "repetir mensaje":
                await RepeatLastTranslationAsync("es", cancellationToken);
                break;

            case "terminar interprete":
            case "termina el interprete":
            case "finalizar interprete":
                await SetInterpreterStateAsync(InterpreterState.Inactive);
                await speechService.SpeakAsync("Intérprete finalizado.", "es", cancellationToken);
                break;

            case "ayuda":
            case "ayudame":
            case "comandos":
                await speechService.SpeakAsync(
                    "Puede decir iniciar intérprete, repetir o terminar intérprete.", "es", cancellationToken);
                break;

            default:
                Debug.WriteLine($"Texto reconocido no asociado a un comando: {recognizedText}");
                break;
        }
    }

    private async Task HandleSpanishConversationTextAsync(string recognizedText, string normalizedText)
    {
        CancellationToken cancellationToken = commandListeningCancellation?.Token ?? CancellationToken.None;

        switch (normalizedText)
        {
            case "terminar interprete":
            case "termina el interprete":
            case "finalizar interprete":
                await SetInterpreterStateAsync(InterpreterState.Inactive);
                await speechService.SpeakAsync("Conversación finalizada.", "es", cancellationToken);
                break;

            case "repetir":
            case "repite":
            case "repetir mensaje":
                await RepeatLastTranslationAsync("es", cancellationToken);
                break;

            default:
                Debug.WriteLine($"Frase reconocida en español: {recognizedText}");
                await TranslateConversationTextAsync(
                    recognizedText,
                    sourceLanguage: "es",
                    targetLanguage: "en",
                    nextState: InterpreterState.ListeningEnglish,
                    cancellationToken);
                break;
        }
    }

    private async Task HandleEnglishConversationTextAsync(string recognizedText, string normalizedText)
    {
        CancellationToken cancellationToken = commandListeningCancellation?.Token ?? CancellationToken.None;

        switch (normalizedText)
        {
            case "terminar interprete":
            case "termina el interprete":
            case "finalizar interprete":
            case "stop interpreter":
            case "end interpreter":
                await SetInterpreterStateAsync(InterpreterState.Inactive);
                await speechService.SpeakAsync("Conversation finished.", "en", cancellationToken);
                break;

            case "repetir":
            case "repite":
            case "repetir mensaje":
            case "repeat":
            case "repeat that":
                await RepeatLastTranslationAsync("en", cancellationToken);
                break;

            default:
                Debug.WriteLine($"Frase reconocida en inglés: {recognizedText}");
                await TranslateConversationTextAsync(
                    recognizedText,
                    sourceLanguage: "en",
                    targetLanguage: "es",
                    nextState: InterpreterState.ListeningSpanish,
                    cancellationToken);
                break;
        }
    }

    private async Task TranslateConversationTextAsync(
        string originalText,
        string sourceLanguage,
        string targetLanguage,
        InterpreterState nextState,
        CancellationToken cancellationToken)
    {
        try
        {
            string translatedText = await translationService.TranslateAsync(
                originalText, sourceLanguage, targetLanguage, cancellationToken);

            await Dispatcher.InvokeAsync(() =>
            {
                RecognizedTextBlock.Text = $"Original: {originalText}";
                TranslatedTextBlock.Text = $"Traducción: {translatedText}";
            });
            Debug.WriteLine($"Traducción {sourceLanguage}->{targetLanguage}: {originalText} -> {translatedText}");

            await speechService.SpeakAsync(translatedText, targetLanguage, cancellationToken);
            LastTranslatedText = translatedText;
            LastTranslationLanguage = targetLanguage;
            await SetInterpreterStateAsync(nextState);
            System.Media.SystemSounds.Beep.Play();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            Debug.WriteLine($"Error al traducir {sourceLanguage}->{targetLanguage}: {exception}");
            await Dispatcher.InvokeAsync(() =>
            {
                MessageBox.Show(
                    $"No se pudo traducir la frase.{Environment.NewLine}{Environment.NewLine}{exception.Message}",
                    "Error de traducción local",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
            });

            string message = sourceLanguage == "es"
                ? "No pude traducir la frase. Por favor, repítala."
                : "I could not translate the sentence. Please repeat it.";
            await speechService.SpeakAsync(message, sourceLanguage, cancellationToken);
        }
    }

    private async Task RepeatLastTranslationAsync(string fallbackLanguage, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(LastTranslatedText) || string.IsNullOrWhiteSpace(LastTranslationLanguage))
        {
            string message = fallbackLanguage == "es"
                ? "No hay ninguna traducción para repetir."
                : "There is no translation to repeat.";
            await speechService.SpeakAsync(message, fallbackLanguage, cancellationToken);
            return;
        }

        await speechService.SpeakAsync(LastTranslatedText, LastTranslationLanguage, cancellationToken);
    }

    private async Task SetInterpreterStateAsync(InterpreterState state)
    {
        interpreterState = state;
        await Dispatcher.InvokeAsync(() =>
        {
            InterpreterStateTextBlock.Text = $"Estado del intérprete: {interpreterState}";
            ListeningLanguageTextBlock.Text = state switch
            {
                InterpreterState.ListeningSpanish => "Idioma escuchado: español",
                InterpreterState.ListeningEnglish => "Idioma escuchado: inglés",
                _ => "Idioma escuchado: comandos en español"
            };
        });
        Debug.WriteLine($"Estado del intérprete: {interpreterState}");
    }

    private async void CheckTranslation_Click(object sender, RoutedEventArgs e)
    {
        await CheckTranslationAsync();
    }

    private async Task<TranslationStatus> CheckTranslationAsync()
    {
        SetTranslationConfigurationControls(isWorking: true);

        try
        {
            TranslationStatus status = await translationService.CheckInstallationAsync();
            UpdateTranslationStatus(status);
            Debug.WriteLine(
                $"Traducción local: Python={status.PythonAvailable}, Argos={status.ArgosTranslateAvailable}, " +
                $"es->en={status.SpanishToEnglishModelAvailable}, en->es={status.EnglishToSpanishModelAvailable}, " +
                $"Error={status.ErrorMessage}");
            return status;
        }
        finally
        {
            SetTranslationConfigurationControls(isWorking: false);
        }
    }

    private async void InstallTranslationModels_Click(object sender, RoutedEventArgs e)
    {
        translationSetupCancellation = new CancellationTokenSource();
        SetTranslationConfigurationControls(isWorking: true);
        Progress<string> progress = new(message =>
        {
            TranslationSetupMessageTextBlock.Text = message;
            Debug.WriteLine($"Configuración de traducción: {message}");
        });

        try
        {
            translationSetupTask = translationService.ConfigureAutomaticallyAsync(
                progress, translationSetupCancellation.Token);
            TranslationStatus status = await translationSetupTask;
            UpdateTranslationStatus(status);
        }
        catch (OperationCanceledException)
        {
            TranslationSetupMessageTextBlock.Text = "Configuración cancelada.";
            Debug.WriteLine("La configuración automática de traducción fue cancelada.");
        }
        catch (Exception exception)
        {
            Debug.WriteLine($"Error instalando modelos de Argos Translate: {exception}");
            MessageBox.Show(
                $"No se pudieron instalar los modelos de traducción.{Environment.NewLine}{Environment.NewLine}{exception.Message}",
                "Error de configuración",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
        finally
        {
            translationSetupCancellation.Dispose();
            translationSetupCancellation = null;
            translationSetupTask = null;
            SetTranslationConfigurationControls(isWorking: false);
        }
    }

    private void UpdateTranslationStatus(TranslationStatus status)
    {
        PythonStatusTextBlock.Text = $"Python: {GetAvailabilityText(status.PythonAvailable)}";
        ArgosStatusTextBlock.Text = $"Argos Translate: {GetAvailabilityText(status.ArgosTranslateAvailable)}";
        SpanishEnglishTranslationStatusTextBlock.Text =
            $"Modelo español → inglés: {GetAvailabilityText(status.SpanishToEnglishModelAvailable)}";
        EnglishSpanishTranslationStatusTextBlock.Text =
            $"Modelo inglés → español: {GetAvailabilityText(status.EnglishToSpanishModelAvailable)}";
        InstallTranslationModelsButton.Visibility = status.IsReady
            ? Visibility.Collapsed
            : Visibility.Visible;
    }

    private void SetTranslationConfigurationControls(bool isWorking)
    {
        CheckTranslationButton.IsEnabled = !isWorking && commandSessionTask is null;
        InstallTranslationModelsButton.IsEnabled = !isWorking && commandSessionTask is null;
        TranslationActivityProgressBar.Visibility = isWorking ? Visibility.Visible : Visibility.Collapsed;
    }

    private static string GetAvailabilityText(bool available)
    {
        return available ? "disponible" : "no disponible";
    }

    private async void DownloadSpanishModel_Click(object sender, RoutedEventArgs e)
    {
        await DownloadModelAsync(isEnglish: false);
    }

    private async void DownloadEnglishModel_Click(object sender, RoutedEventArgs e)
    {
        await DownloadModelAsync(isEnglish: true);
    }

    private async Task DownloadModelAsync(bool isEnglish)
    {
        DownloadSpanishModelButton.IsEnabled = false;
        DownloadEnglishModelButton.IsEnabled = false;
        ModelDownloadProgressBar.Value = 0;
        ModelDownloadProgressBar.Visibility = Visibility.Visible;
        Progress<double> progress = new(value => ModelDownloadProgressBar.Value = value);

        try
        {
            if (isEnglish)
            {
                await speechRecognitionService.DownloadEnglishModelAsync(progress);
            }
            else
            {
                await speechRecognitionService.DownloadSpanishModelAsync(progress);
            }

            UpdateModelControls();
        }
        catch (Exception exception)
        {
            string language = isEnglish ? "inglés" : "español";
            MessageBox.Show($"No se pudo descargar el modelo de {language}.{Environment.NewLine}{Environment.NewLine}{exception.Message}",
                "Error de configuración", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            DownloadSpanishModelButton.IsEnabled = true;
            DownloadEnglishModelButton.IsEnabled = true;
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
        bool spanishModelInstalled = speechRecognitionService.IsSpanishModelInstalled();
        bool englishModelInstalled = speechRecognitionService.IsEnglishModelInstalled();

        SpanishModelStatusTextBlock.Text = spanishModelInstalled
            ? "Modelo español: instalado"
            : "Modelo español: no instalado";
        EnglishModelStatusTextBlock.Text = englishModelInstalled
            ? "English model: installed"
            : "English model: not installed";
        DownloadSpanishModelButton.Visibility = spanishModelInstalled ? Visibility.Collapsed : Visibility.Visible;
        DownloadEnglishModelButton.Visibility = englishModelInstalled ? Visibility.Collapsed : Visibility.Visible;
        TestMicrophoneButton.IsEnabled = spanishModelInstalled && commandSessionTask is null;
        StartCommandListeningButton.IsEnabled = spanishModelInstalled && commandSessionTask is null;
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

    private async Task ReportRecognitionErrorAsync(Exception exception, string title)
    {
        Debug.WriteLine($"Error de reconocimiento: {exception}");
        MessageBox.Show($"{title}{Environment.NewLine}{Environment.NewLine}{exception.Message}",
            "Error de reconocimiento local", MessageBoxButton.OK, MessageBoxImage.Error);

        try
        {
            await speechService.SpeakAsync("Ocurrió un problema con el reconocimiento de voz.", "es");
        }
        catch (Exception speechException)
        {
            Debug.WriteLine($"No se pudo anunciar el error: {speechException.Message}");
        }
    }

    private void SetListeningControls(bool isListening)
    {
        StartCommandListeningButton.IsEnabled = !isListening && speechRecognitionService.IsSpanishModelInstalled();
        StopCommandListeningButton.IsEnabled = isListening;
        DownloadSpanishModelButton.IsEnabled = !isListening;
        DownloadEnglishModelButton.IsEnabled = !isListening;
        CheckTranslationButton.IsEnabled = !isListening;
        InstallTranslationModelsButton.IsEnabled = !isListening;
        ListeningStatusTextBlock.Text = isListening ? "Escucha: activa" : "Escucha: detenida";
        SetTestButtonsEnabled(!isListening);
    }

    private void SetTestButtonsEnabled(bool isEnabled)
    {
        TestSpanishButton.IsEnabled = isEnabled;
        TestEnglishButton.IsEnabled = isEnabled;
        TestMicrophoneButton.IsEnabled = isEnabled && speechRecognitionService.IsSpanishModelInstalled();
    }

    private static string NormalizeCommand(string text)
    {
        string decomposed = text.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        StringBuilder withoutAccents = new();

        foreach (char character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
            {
                withoutAccents.Append(character);
            }
        }

        return string.Join(' ', withoutAccents.ToString().Split(
            (char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }
}
