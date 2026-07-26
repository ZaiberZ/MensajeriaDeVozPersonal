namespace Shared.Models;

public class DailyErrorLogSnapshotDto
{
    public DateTime CapturedAt { get; set; }
    public int Count { get; set; }
    public List<ErrorLogSnapshotItemDto> Logs { get; set; } = [];
}

public class ErrorLogSnapshotItemDto
{
    public DateTime Timestamp { get; set; }
    public DateTime LastAttemptAt { get; set; }
    public string Source { get; set; } = "";
    public string Message { get; set; } = "";
    public string? Detail { get; set; }
    public int AttemptCount { get; set; }
}
