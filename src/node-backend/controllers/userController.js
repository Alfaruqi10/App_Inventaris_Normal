import { UserService } from '../services/userService.js';
import { UserSheetRepository } from '../repositories/sheets/userSheetRepo.js';
import { sendCompatibleResponse, sendErrorResponse } from './adapter.js';

const userRepository = new UserSheetRepository();
const userService = new UserService(userRepository);

/**
 * register - Handler untuk membuat akun user baru.
 */
export async function register(req, res) {
  try {
    const { email, nama, password, role } = req.body;
    const result = await userService.registerUser(email, nama, password, role);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[UserController ERROR] Registration failed:', error);
    return sendErrorResponse(res, 'Gagal melakukan registrasi akun baru.', error);
  }
}

/**
 * login - Handler untuk login pengguna.
 */
export async function login(req, res) {
  try {
    const { email, password } = req.body;
    const result = await userService.loginUser(email, password);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[UserController ERROR] Login failed:', error);
    return sendErrorResponse(res, 'Gagal memproses masuk akun.', error);
  }
}

/**
 * getUsers - Handler untuk mengambil seluruh daftar pengguna (hanya Admin).
 */
export async function getUsers(req, res) {
  try {
    const { role } = req.query.action ? req.query : req.body;
    const result = await userService.getAllUsers(role);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[UserController ERROR] Fetch users failed:', error);
    return sendErrorResponse(res, 'Gagal mengambil data daftar pengguna.', error);
  }
}

/**
 * updateUser - Handler untuk memperbarui data nama/role pengguna.
 */
export async function updateUser(req, res) {
  try {
    const { callerRole, email, nama, role } = req.body;
    const result = await userService.updateUser(callerRole, email, { nama, role });
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[UserController ERROR] Update user failed:', error);
    return sendErrorResponse(res, 'Gagal memperbarui data pengguna.', error);
  }
}

/**
 * resetPassword - Handler untuk mengatur ulang kata sandi pengguna.
 */
export async function resetPassword(req, res) {
  try {
    const { callerRole, email, passwordBaru } = req.body;
    const result = await userService.resetPassword(callerRole, email, passwordBaru);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[UserController ERROR] Reset password failed:', error);
    return sendErrorResponse(res, 'Gagal mengatur ulang kata sandi.', error);
  }
}

/**
 * toggleUserStatus - Handler untuk mengaktifkan/menonaktifkan pengguna.
 */
export async function toggleUserStatus(req, res) {
  try {
    const { callerRole, email, aktif } = req.body;
    const result = await userService.toggleUserStatus(callerRole, email, aktif);
    return sendCompatibleResponse(res, result);
  } catch (error) {
    console.error('[UserController ERROR] Toggle status failed:', error);
    return sendErrorResponse(res, 'Gagal mengubah status aktif pengguna.', error);
  }
}
