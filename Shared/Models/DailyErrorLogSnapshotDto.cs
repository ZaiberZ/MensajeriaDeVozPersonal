namespace Shared.Models;

public class DailyErrorLogSnapshotDto
{
    public DateTimeOffset CapturedAt { get; set; }
    public int Count { get; set; }
    public List<ErrorLogSnapshotItemDto> Logs { get; set; } = [];
}

public class ErrorLogSnapshotItemDto
{
    public DateTimeOffset Timestamp { get; set; }
    public DateTimeOffset LastAttemptAt { get; set; }
    public string Source { get; set; } = "";
    public string Message { get; set; } = "";
    public string? Detail { get; set; }
    public int AttemptCount { get; set; }
}
