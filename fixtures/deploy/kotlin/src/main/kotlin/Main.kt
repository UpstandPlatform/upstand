import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    val server = HttpServer.create(InetSocketAddress(port), 0)
    server.createContext("/") { exchange ->
        val body = "hello from kotlin\n".toByteArray()
        exchange.sendResponseHeaders(200, body.size.toLong())
        exchange.responseBody.use { it.write(body) }
    }
    server.start()
    println("listening on $port")
}
