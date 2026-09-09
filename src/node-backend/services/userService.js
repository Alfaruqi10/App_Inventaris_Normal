import crypto from 'crypto';
import { getJakartaTimeString } from '../utils/dateFormatter.js';

export class UserService {
  /**
   * @param {UserRepository} userRepository
   */
  constructor(userRepository) {
    this.userRepo = userRepository;
    this.passwordSalt = "inventaris_salt_2024";
  }

  /**
   * Meng-hash kata sandi menggunakan SHA-256 dan encoding Base64.
   */
  hashPassword(password) {
    const hash = crypto.createHash('sha256');
    hash.update(this.passwordSalt + password);
    return hash.digest('base64');
  }

  /**
   * Validasi format alamat email.
   */
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /**
   * Registrasi Akun Pengguna Baru.
   */
  async registerUser(email, nama, password, role) {
    email = String(email || '').trim().toLowerCase();
    nama = String(nama || '').trim();
    password = String(password || '');
    role = String(role || 'Kasir').trim();

    if (role !== "Admin") {
      role = "Kasir";
    }

    if (!nama || !email || !password) {
      return {
        status: "error",
        message: "Nama, email, dan password wajib diisi."
      };
    }

    if (!this.isValidEmail(email)) {
      return {
        status: "error",
        message: "Format email tidak valid."
      };
    }

    if (password.length < 6) {
      return {
        status: "error",
        message: "Password minimal 6 karakter."
      };
    }

    const existingUser = await this.userRepo.findByEmail(email);
    if (existingUser) {
      return {
        status: "error",
        message: "Email sudah terdaftar: " + email
      };
    }

    const newUser = {
      email,
      nama,
      password: this.hashPassword(password),
      createdAt: getJakartaTimeString(),
      role
    };

    await this.userRepo.createUser(newUser);

    return {
      status: "success",
      message: "Akun berhasil dibuat: " + email,
      user: {
        email,
        nama,
        role
      }
    };
  }

  /**
   * Login Pengguna.
   */
  async loginUser(email, password) {
    email = String(email || '').trim().toLowerCase();
    password = String(password || '');

    if (!email || !password) {
      return {
        status: "error",
        message: "Email dan password wajib diisi."
      };
    }

    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      return {
        status: "error",
        message: "Email atau password salah."
      };
    }

    // Periksa status aktif
    if (String(user.aktif).toLowerCase() === 'tidak') {
      return {
        status: "error",
        message: "Akun Anda dinonaktifkan. Hubungi admin."
      };
    }

    const hashedPasswordInput = this.hashPassword(password);
    if (user.password !== hashedPasswordInput) {
      return {
        status: "error",
        message: "Email atau password salah."
      };
    }

    return {
      status: "success",
      message: "Login berhasil.",
      user: {
        email: user.email,
        nama: user.nama,
        role: user.role
      }
    };
  }

  /**
   * Mendapatkan Semua Pengguna (Hanya Admin).
   */
  async getAllUsers(role) {
    if (String(role).trim() !== "Admin") {
      return { status: "error", message: "Akses ditolak." };
    }

    const usersList = await this.userRepo.getAllUsers();
    return { status: "success", users: usersList };
  }

  /**
   * Memperbarui Data Pengguna (Hanya Admin).
   */
  async updateUser(callerRole, email, updates) {
    if (String(callerRole).trim() !== "Admin") {
      return { status: "error", message: "Akses ditolak." };
    }

    email = String(email || '').trim().toLowerCase();
    const targetUser = await this.userRepo.findByEmail(email);
    if (!targetUser) {
      return { status: "error", message: "User tidak ditemukan." };
    }

    const formattedUpdates = {};
    if (updates.nama !== undefined) {
      formattedUpdates.nama = String(updates.nama).trim();
    }
    if (updates.role !== undefined) {
      const targetRole = String(updates.role).trim();
      formattedUpdates.role = targetRole === "Admin" ? "Admin" : "Kasir";
    }

    await this.userRepo.updateUser(email, formattedUpdates);
    return { status: "success", message: "User berhasil diperbarui." };
  }

  /**
   * Reset Sandi Pengguna (Hanya Admin).
   */
  async resetPassword(callerRole, email, passwordBaru) {
    if (String(callerRole).trim() !== "Admin") {
      return { status: "error", message: "Akses ditolak." };
    }

    email = String(email || '').trim().toLowerCase();
    passwordBaru = String(passwordBaru || '');

    if (!passwordBaru || passwordBaru.length < 6) {
      return { status: "error", message: "Password minimal 6 karakter." };
    }

    const targetUser = await this.userRepo.findByEmail(email);
    if (!targetUser) {
      return { status: "error", message: "Akun tidak ditemukan: " + email };
    }

    const hashed = this.hashPassword(passwordBaru);
    await this.userRepo.updatePassword(email, hashed);

    return { status: "success", message: "Password berhasil diubah untuk: " + email };
  }

  /**
   * Mengaktifkan / Menutup Akun Pengguna (Hanya Admin).
   */
  async toggleUserStatus(callerRole, email, aktifState) {
    if (String(callerRole).trim() !== "Admin") {
      return { status: "error", message: "Akses ditolak." };
    }

    email = String(email || '').trim().toLowerCase();
    const targetUser = await this.userRepo.findByEmail(email);
    if (!targetUser) {
      return { status: "error", message: "User tidak ditemukan." };
    }

    await this.userRepo.setUserStatus(email, aktifState);
    return {
      status: "success",
      message: aktifState ? "User diaktifkan." : "User dinonaktifkan."
    };
  }
}
