var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

// Port comes from ASPNETCORE_URLS (set by the start command to the injected $PORT).
app.MapGet("/", () => "hello from .NET\n");

app.Run();
