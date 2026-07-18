namespace AlexaSkillWhatsApp.Services;

public static class FirebaseHttpClient
{
    public static HttpClient Create() => new(new FirebaseAuthHandler());

    private sealed class FirebaseAuthHandler : HttpClientHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var token = await FirebaseAuthTokenProvider.GetIdTokenAsync(cancellationToken);
            request.RequestUri = AddAuthToken(request.RequestUri, token);
            return await base.SendAsync(request, cancellationToken);
        }

        private static Uri AddAuthToken(Uri? uri, string token)
        {
            ArgumentNullException.ThrowIfNull(uri);
            var separator = string.IsNullOrEmpty(uri.Query) ? "?" : "&";
            return new Uri($"{uri}{separator}auth={Uri.EscapeDataString(token)}");
        }
    }
}
