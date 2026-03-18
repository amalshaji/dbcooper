use clap::Parser;
use dbcooper_lib::database::pool_manager::PoolManager;
use dbcooper_lib::db;
use dbcooper_lib::mcp::McpServer;
use rmcp::ServiceExt;

#[derive(Parser)]
#[command(name = "dbcooper-mcp", about = "MCP server for DBcooper database client")]
struct Args {
    /// Run in read-only mode (only allow SELECT/WITH/EXPLAIN queries).
    /// This is the default. Use --no-read-only to allow write queries.
    #[arg(long, default_value_t = true, action = clap::ArgAction::SetTrue)]
    read_only: bool,

    /// Allow write queries (INSERT, UPDATE, DELETE, etc.)
    #[arg(long, default_value_t = false)]
    no_read_only: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let read_only = args.read_only && !args.no_read_only;

    // Initialize the SQLite pool (same database as the GUI app)
    let sqlite_pool = db::init_pool().await.map_err(|e| {
        eprintln!("Failed to initialize database: {}", e);
        e
    })?;

    let pool_manager = PoolManager::new();
    let server = McpServer::new(sqlite_pool, pool_manager, read_only);

    // Start the MCP server on stdio
    let service = server.serve(rmcp::transport::io::stdio()).await?;

    // Wait for the service to complete
    service.waiting().await?;

    Ok(())
}
