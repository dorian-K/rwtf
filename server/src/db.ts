import mariadb from "mariadb";

const pool = mariadb.createPool({
    host: process.env.DB_HOST ?? "mariadb",
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER ?? "myuser",
    password: process.env.DB_PASSWORD ?? "mypassword",
    database: process.env.DB_NAME ?? "mydatabase",
    connectionLimit: 5,
});

export const getConnection = async () => {
    try {
        const connection = await pool.getConnection();
        return connection;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

export default pool;
