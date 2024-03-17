import mariadb from "mariadb";

const pool = mariadb.createPool({
    host: "mariadb",
    user: "myuser",
    password: "mypassword",
    database: "mydatabase",
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
