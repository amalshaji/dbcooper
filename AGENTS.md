## DBcooper

- Do not add unnecessary comments unless absolutely necessary
- The project uses tauri for the backend (https://v2.tauri.app/)
- The project uses bun + react (ts) for the frontend
- The project uses sqlite as the primary database
- The project uses sqlx as the querybuilder and for database connections (https://sqlx.io/)
- Every submit must have a loading state, use the Spinner component from shadcn. Do not change the text in loading state.
- Run shadcn commands inside the src/ directory.
- Make sure components files don't get too big, split into multiple files if needed.
