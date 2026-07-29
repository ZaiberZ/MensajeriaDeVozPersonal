using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;

namespace VoiceInterpreter;

public sealed class TranslationService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };
    private readonly AppSettings settings;
    private string? resolvedPythonExecutablePath;

    public TranslationService(AppSettings settings)
    {
        this.settings = settings;
    }

    public async Task<string> TranslateAsync(
        string text, string sourceLanguage, string targetLanguage, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new ArgumentException("El texto que se traducirá no puede estar vacío.", nameof(text));
        }

        ValidateLanguagePair(sourceLanguage, targetLanguage);
        ValidateTranslationScript();

        ProcessResult result = await RunPythonAsync(
            new[] { GetTranslationScriptPath(), sourceLanguage, targetLanguage }, text, cancellationToken);
        EnsureSuccessfulResult(result, "La traducción local falló");

        string translatedText = result.StandardOutput.Trim();
        if (string.IsNullOrWhiteSpace(translatedText))
        {
            throw new InvalidOperationException("Argos Translate devolvió un resultado vacío.");
        }

        return translatedText;
    }

    public async Task<TranslationStatus> CheckInstallationAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            ProcessResult pythonResult = await RunPythonAsync(new[] { "--version" }, null, cancellationToken);
            if (pythonResult.ExitCode != 0)
            {
                return new TranslationStatus
                {
                    ErrorMessage = GetProcessError(pythonResult, "Python no pudo ejecutarse.")
                };
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return new TranslationStatus
            {
                ErrorMessage = $"Python no está disponible: {exception.Message}"
            };
        }

        try
        {
            ValidateTranslationScript();
            ProcessResult checkResult = await RunPythonAsync(
                new[] { GetTranslationScriptPath(), "--check" }, null, cancellationToken);
            EnsureSuccessfulResult(checkResult, "No se pudo verificar Argos Translate");

            PythonTranslationStatus? pythonStatus = JsonSerializer.Deserialize<PythonTranslationStatus>(
                checkResult.StandardOutput, JsonOptions);

            return new TranslationStatus
            {
                PythonAvailable = true,
                ArgosTranslateAvailable = pythonStatus?.ArgosTranslateAvailable ?? false,
                SpanishToEnglishModelAvailable = pythonStatus?.SpanishToEnglishModelAvailable ?? false,
                EnglishToSpanishModelAvailable = pythonStatus?.EnglishToSpanishModelAvailable ?? false,
                ErrorMessage = pythonStatus?.ErrorMessage ?? "El script devolvió un estado inválido."
            };
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return new TranslationStatus
            {
                PythonAvailable = true,
                ErrorMessage = exception.Message
            };
        }
    }

    public async Task InstallModelsAsync(
        IProgress<string>? progress = null, CancellationToken cancellationToken = default)
    {
        ValidateTranslationScript();
        ProcessResult result = await RunPythonAsync(
            new[] { GetTranslationScriptPath(), "--install-models" }, null, cancellationToken, progress);
        EnsureSuccessfulResult(result, "No se pudieron instalar los modelos de Argos Translate");

        foreach (string line in result.StandardOutput.Split(
            new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries))
        {
            Debug.WriteLine($"Argos Translate: {line}");
        }
    }

    public async Task<TranslationStatus> ConfigureAutomaticallyAsync(
        IProgress<string>? progress = null, CancellationToken cancellationToken = default)
    {
        TranslationStatus status = await CheckInstallationAsync(cancellationToken);

        if (!status.PythonAvailable)
        {
            progress?.Report("Instalando Python 3.11...");
            await InstallPythonAsync(cancellationToken);
        }

        status = await CheckInstallationAsync(cancellationToken);
        if (!status.PythonAvailable)
        {
            throw new InvalidOperationException(
                $"Python no quedó disponible después de la instalación. {status.ErrorMessage}");
        }

        if (!status.ArgosTranslateAvailable)
        {
            progress?.Report("Instalando Argos Translate...");
            ProcessResult pipResult = await RunPythonAsync(
                new[] { "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "argostranslate" },
                null,
                cancellationToken);
            EnsureSuccessfulResult(pipResult, "No se pudo instalar Argos Translate con pip");
        }

        progress?.Report("Instalando modelos de traducción...");
        await InstallModelsAsync(progress, cancellationToken);

        progress?.Report("Verificando la configuración...");
        status = await CheckInstallationAsync(cancellationToken);
        if (!status.IsReady)
        {
            throw new InvalidOperationException(
                $"La configuración automática no se completó. {status.ErrorMessage}");
        }

        progress?.Report("Configuración completada.");
        return status;
    }

    private async Task InstallPythonAsync(CancellationToken cancellationToken)
    {
        string[] arguments =
        {
            "install",
            "--id",
            "Python.Python.3.11",
            "--exact",
            "--source",
            "winget",
            "--scope",
            "user",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
            "--disable-interactivity"
        };

        ProcessResult wingetResult = await RunProcessAsync("winget", arguments, null, cancellationToken);
        resolvedPythonExecutablePath = FindInstalledPython();

        if (resolvedPythonExecutablePath is null)
        {
            EnsureSuccessfulResult(wingetResult, "WinGet no pudo instalar Python 3.11");
            throw new InvalidOperationException(
                "WinGet terminó, pero no se encontró python.exe. Reinicia la aplicación y vuelve a verificar.");
        }
    }

    private async Task<ProcessResult> RunPythonAsync(
        IReadOnlyList<string> arguments,
        string? standardInput,
        CancellationToken cancellationToken,
        IProgress<string>? standardOutputProgress = null)
    {
        return await RunProcessAsync(
            GetPythonExecutablePath(), arguments, standardInput, cancellationToken, standardOutputProgress);
    }

    private static async Task<ProcessResult> RunProcessAsync(
        string executablePath,
        IReadOnlyList<string> arguments,
        string? standardInput,
        CancellationToken cancellationToken,
        IProgress<string>? standardOutputProgress = null)
    {
        ProcessStartInfo startInfo = new()
        {
            FileName = executablePath,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = AppContext.BaseDirectory
        };
        string argosRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "VoiceInterpreter",
            "Argos");
        startInfo.Environment["XDG_CONFIG_HOME"] = Path.Combine(argosRoot, "config");
        startInfo.Environment["XDG_DATA_HOME"] = Path.Combine(argosRoot, "data");
        startInfo.Environment["XDG_CACHE_HOME"] = Path.Combine(argosRoot, "cache");

        foreach (string argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using Process process = new()
        {
            StartInfo = startInfo
        };

        try
        {
            if (!process.Start())
            {
                throw new InvalidOperationException("No se pudo iniciar el proceso de Python.");
            }
        }
        catch (Win32Exception exception)
        {
            throw new InvalidOperationException(
                $"No se encontró o no se pudo ejecutar '{startInfo.FileName}'.", exception);
        }

        Task<string> standardOutputTask;
        if (standardOutputProgress is null)
        {
            standardOutputTask = process.StandardOutput.ReadToEndAsync();
        }
        else
        {
            StringBuilder output = new();
            TaskCompletionSource<string> outputCompleted = new(TaskCreationOptions.RunContinuationsAsynchronously);
            process.OutputDataReceived += (_, eventArgs) =>
            {
                if (eventArgs.Data is null)
                {
                    outputCompleted.TrySetResult(output.ToString());
                    return;
                }

                output.AppendLine(eventArgs.Data);
                standardOutputProgress.Report(eventArgs.Data);
            };
            process.BeginOutputReadLine();
            standardOutputTask = outputCompleted.Task;
        }
        Task<string> standardErrorTask = process.StandardError.ReadToEndAsync();

        try
        {
            if (standardInput is not null)
            {
                await process.StandardInput.WriteAsync(standardInput.AsMemory(), cancellationToken);
            }

            process.StandardInput.Close();
            await process.WaitForExitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync();
            }

            throw;
        }

        return new ProcessResult(
            process.ExitCode,
            await standardOutputTask,
            await standardErrorTask);
    }

    private string GetPythonExecutablePath()
    {
        if (!string.IsNullOrWhiteSpace(resolvedPythonExecutablePath))
        {
            return resolvedPythonExecutablePath;
        }

        if (string.IsNullOrWhiteSpace(settings.PythonExecutablePath))
        {
            throw new InvalidOperationException("PythonExecutablePath no está configurado.");
        }

        bool containsDirectory = settings.PythonExecutablePath.Contains(Path.DirectorySeparatorChar)
            || settings.PythonExecutablePath.Contains(Path.AltDirectorySeparatorChar);
        if (!Path.IsPathRooted(settings.PythonExecutablePath) && !containsDirectory)
        {
            return settings.PythonExecutablePath;
        }

        string executablePath = Path.GetFullPath(settings.PythonExecutablePath, AppContext.BaseDirectory);
        return File.Exists(executablePath)
            ? executablePath
            : throw new FileNotFoundException($"No se encontró el ejecutable de Python en '{executablePath}'.");
    }

    private static string? FindInstalledPython()
    {
        string[] candidates =
        {
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "Python", "Python311", "python.exe"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Python311", "python.exe"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Python311", "python.exe")
        };

        return candidates.FirstOrDefault(File.Exists);
    }

    private string GetTranslationScriptPath()
    {
        return Path.GetFullPath(settings.TranslationScriptPath, AppContext.BaseDirectory);
    }

    private void ValidateTranslationScript()
    {
        string scriptPath = GetTranslationScriptPath();
        if (!File.Exists(scriptPath))
        {
            throw new FileNotFoundException($"No se encontró el script de traducción en '{scriptPath}'.");
        }
    }

    private static void ValidateLanguagePair(string sourceLanguage, string targetLanguage)
    {
        bool supported = (sourceLanguage == "es" && targetLanguage == "en")
            || (sourceLanguage == "en" && targetLanguage == "es");

        if (!supported)
        {
            throw new ArgumentException(
                $"La traducción '{sourceLanguage}->{targetLanguage}' no es compatible. Usa 'es->en' o 'en->es'.");
        }
    }

    private static void EnsureSuccessfulResult(ProcessResult result, string message)
    {
        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException(GetProcessError(result, message));
        }
    }

    private static string GetProcessError(ProcessResult result, string fallbackMessage)
    {
        string error = result.StandardError.Trim();
        return string.IsNullOrWhiteSpace(error)
            ? $"{fallbackMessage} Código de salida: {result.ExitCode}."
            : $"{fallbackMessage}. {error} Código de salida: {result.ExitCode}.";
    }

    private sealed class PythonTranslationStatus
    {
        public bool ArgosTranslateAvailable { get; init; }

        public bool SpanishToEnglishModelAvailable { get; init; }

        public bool EnglishToSpanishModelAvailable { get; init; }

        public string ErrorMessage { get; init; } = string.Empty;
    }

    private sealed record ProcessResult(int ExitCode, string StandardOutput, string StandardError);
}
