using VoiceMessaging.Worker;


var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddWindowsService(options => { options.ServiceName = "Voice Messaging Worker"; });
builder.Services.AddHostedService<Worker>();

builder.Services.Configure<MySettings>(builder.Configuration.GetSection("MisAjustes"));

// builder.Services.AddHttpClient<WhatsAppService>(client =>{    cl ient.BaseAddress = new Uri("http://localhost:3000");});
// builder.Services.AddHttpClient<FirebaseService>();

var host = builder.Build();

host.Run();