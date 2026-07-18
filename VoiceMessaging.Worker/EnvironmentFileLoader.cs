namespace VoiceMessaging.Worker;

internal static class EnvironmentFileLoader
{
    public static void Load()
    {
        foreach (var path in GetCandidatePaths())
        {
            if (!File.Exists(path))
                continue;

            LoadFile(path);
            return;
        }
    }

    private static IEnumerable<string> GetCandidatePaths()
    {
        yield return Path.Combine(Directory.GetCurrentDirectory(), ".env.local");
        yield return Path.Combine(AppContext.BaseDirectory, ".env.local");

        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        if (!string.IsNullOrWhiteSpace(programData))
            yield return Path.Combine(programData, "VoiceMessaging", "environment.env");
    }

    private static void LoadFile(string path)
    {
        foreach (var line in File.ReadLines(path))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#'))
                continue;

            var separator = trimmed.IndexOf('=');
            if (separator <= 0)
                continue;

            var name = trimmed[..separator].Trim();
            var value = trimmed[(separator + 1)..].Trim();

            if (value.Length >= 2 && value[0] == '"' && value[^1] == '"')
                value = value[1..^1].Replace("\\\"", "\"");

            if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(name)))
                Environment.SetEnvironmentVariable(name, value);
        }
    }
}
