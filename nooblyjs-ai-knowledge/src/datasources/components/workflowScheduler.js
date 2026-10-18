/**
 * WorkflowScheduler - Manages workflow schedules and scheduling
 * Stores schedules in /.application/workflow/workflows.schedules.json
 * Uses digital-technologies-core scheduler service for actual scheduling
 */

const fs = require('node:fs').promises;
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');

class WorkflowScheduler {
  constructor(deps = {}) {
    this.workflowManager = deps.workflowManager;
    this.workflowExecutor = deps.workflowExecutor;
    this.scheduler = deps.scheduler; // From digital-technologies-core
    this.logger = deps.logger;
    const appBaseDir = deps.appBaseDir || path.join(process.cwd(), '.application');
    this.schedulesFile = path.join(appBaseDir, 'workflow', 'workflows.schedules.json');
    this.schedules = [];
    this.activeSchedules = new Map(); // Track active schedule timers
    this.initialized = false;
  }

  /**
   * Initialize scheduler
   */
  async initialize() {
    try {
      await this.loadSchedules();
      await this.reactivateSchedules();
      this.initialized = true;
      this.logger?.info('WorkflowScheduler initialized', {
        scheduleCount: this.schedules.length,
        activeCount: this.activeSchedules.size
      });
    } catch (error) {
      this.logger?.error('Failed to initialize WorkflowScheduler', { error: error.message });
      this.schedules = [];
      this.initialized = true;
    }
  }

  /**
   * Load schedules from JSON file
   */
  async loadSchedules() {
    try {
      const data = await fs.readFile(this.schedulesFile, 'utf8');
      this.schedules = JSON.parse(data);
      return this.schedules;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.schedules = [];
        await this.saveSchedules();
        return [];
      }
      throw error;
    }
  }

  /**
   * Save schedules to JSON file
   */
  async saveSchedules() {
    try {
      const dir = path.dirname(this.schedulesFile);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.schedulesFile, JSON.stringify(this.schedules, null, 2));
    } catch (error) {
      this.logger?.error('Failed to save schedules', { error: error.message });
      throw error;
    }
  }

  /**
   * Create a schedule
   * @param {Object} scheduleData - { workflowId, name, cronExpression or interval, input?, enabled? }
   * @returns {Object} Created schedule
   */
  async createSchedule(scheduleData) {
    try {
      const { workflowId, name, cronExpression, interval, input, description } = scheduleData;

      if (!workflowId) throw new Error('workflowId is required');
      if (!name) throw new Error('Schedule name is required');
      if (!cronExpression && !interval) {
        throw new Error('Either cronExpression or interval is required');
      }

      // Verify workflow exists
      this.workflowManager.getWorkflow(workflowId);

      const schedule = {
        id: uuidv4(),
        workflowId,
        name,
        description: description || '',
        cronExpression: cronExpression || null,
        interval: interval || null, // In milliseconds
        input: input || {},
        enabled: scheduleData.enabled !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastRun: null,
        nextRun: this.calculateNextRun(cronExpression, interval),
        executionCount: 0,
        lastResult: null,
        lastError: null
      };

      this.schedules.push(schedule);
      await this.saveSchedules();

      // Activate if enabled
      if (schedule.enabled) {
        await this.activateSchedule(schedule.id);
      }

      this.logger?.info('Schedule created', {
        scheduleId: schedule.id,
        workflowId,
        name
      });

      return schedule;
    } catch (error) {
      this.logger?.error('Failed to create schedule', { error: error.message });
      throw error;
    }
  }

  /**
   * Get schedule by ID
   */
  getSchedule(scheduleId) {
    const schedule = this.schedules.find(s => s.id === scheduleId);
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
    return schedule;
  }

  /**
   * Update schedule
   */
  async updateSchedule(scheduleId, updates) {
    try {
      const schedule = this.getSchedule(scheduleId);

      // Deactivate if was active
      if (this.activeSchedules.has(scheduleId)) {
        await this.deactivateSchedule(scheduleId);
      }

      // Update fields
      if (updates.name) schedule.name = updates.name;
      if (updates.description !== undefined) schedule.description = updates.description;
      if (updates.cronExpression !== undefined) schedule.cronExpression = updates.cronExpression;
      if (updates.interval !== undefined) schedule.interval = updates.interval;
      if (updates.input !== undefined) schedule.input = updates.input;

      schedule.updatedAt = new Date().toISOString();
      schedule.nextRun = this.calculateNextRun(schedule.cronExpression, schedule.interval);

      await this.saveSchedules();

      // Reactivate if enabled
      if (schedule.enabled) {
        await this.activateSchedule(scheduleId);
      }

      this.logger?.info('Schedule updated', { scheduleId });
      return schedule;
    } catch (error) {
      this.logger?.error('Failed to update schedule', { error: error.message });
      throw error;
    }
  }

  /**
   * Delete schedule
   */
  async deleteSchedule(scheduleId) {
    try {
      await this.deactivateSchedule(scheduleId);

      const index = this.schedules.findIndex(s => s.id === scheduleId);
      if (index === -1) throw new Error(`Schedule not found: ${scheduleId}`);

      this.schedules.splice(index, 1);
      await this.saveSchedules();

      this.logger?.info('Schedule deleted', { scheduleId });
      return true;
    } catch (error) {
      this.logger?.error('Failed to delete schedule', { error: error.message });
      throw error;
    }
  }

  /**
   * Activate schedule (start triggering)
   */
  async activateSchedule(scheduleId) {
    try {
      if (this.activeSchedules.has(scheduleId)) return; // Already active

      const schedule = this.getSchedule(scheduleId);
      const activityPath = path.resolve(__dirname, '../../configuration/activities/run-workflow.js');

      const onExecutionComplete = (status, result) => {
        try {
          schedule.lastRun = new Date().toISOString();
          schedule.executionCount += 1;

          if (status === 'success') {
            schedule.lastResult = result?.result?.outcome || result?.outcome || 'success';
            schedule.lastError = null;
          } else {
            schedule.lastError = result?.error?.message || result?.message || 'Unknown error';
          }

          this.saveSchedules().catch(err => {
            this.logger?.error('Failed to update schedule after execution', { error: err.message });
          });
        } catch (error) {
          this.logger?.error('Error in execution callback', { error: error.message });
        }
      };

      // Use scheduler with activity for both interval and cron
      if (this.scheduler && this.scheduler.start) {
        const taskName = `workflow-${scheduleId}`;
        const taskData = {
          workflowId: schedule.workflowId,
          payload: schedule.input
        };

        let intervalSeconds;

        if (schedule.interval) {
          // Convert milliseconds to seconds
          intervalSeconds = Math.ceil(schedule.interval / 1000);
        } else if (schedule.cronExpression) {
          // For cron-based: use 1-minute interval and check cron match
          intervalSeconds = 60;
        }

        this.logger?.debug('Activating schedule task', { taskName, activityPath, intervalSeconds });
        await this.scheduler.start(taskName, activityPath, taskData, intervalSeconds, onExecutionComplete);
        this.activeSchedules.set(scheduleId, { type: 'scheduler', taskName });

        this.logger?.info('Schedule activated', {
          scheduleId,
          taskName,
          intervalSeconds,
          type: schedule.interval ? 'interval' : 'cron'
        });
      } else {
        throw new Error('Scheduler service not available');
      }
    } catch (error) {
      this.logger?.error('Failed to activate schedule', { error: error.message });
      throw error;
    }
  }

  /**
   * Deactivate schedule (stop triggering)
   */
  async deactivateSchedule(scheduleId) {
    if (!this.activeSchedules.has(scheduleId)) return;

    const scheduleInfo = this.activeSchedules.get(scheduleId);

    // If it was started via scheduler, stop it
    if (scheduleInfo.type === 'scheduler' && this.scheduler && this.scheduler.stop) {
      try {
        await this.scheduler.stop(scheduleInfo.taskName);
      } catch (error) {
        this.logger?.error('Failed to stop scheduler task', { error: error.message, taskName: scheduleInfo.taskName });
      }
    }

    this.activeSchedules.delete(scheduleId);
    this.logger?.info('Schedule deactivated', { scheduleId });
  }

  /**
   * Simple cron timer setup (basic implementation)
   * Supports: minute, hour, day, month, day-of-week
   * Example: "0 2 * * *" = every day at 2:00 AM
   */
  setupCronTimer(cronExpression, callback) {
    const parts = cronExpression.split(' ');
    if (parts.length !== 5) {
      throw new Error('Invalid cron expression format (expected: minute hour day month day-of-week)');
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Check every minute
    return setInterval(() => {
      const now = new Date();
      const currentMinute = now.getMinutes();
      const currentHour = now.getHours();
      const currentDay = now.getDate();
      const currentMonth = now.getMonth() + 1;
      const currentDayOfWeek = now.getDay();

      const matchesMinute = minute === '*' || parseInt(minute) === currentMinute;
      const matchesHour = hour === '*' || parseInt(hour) === currentHour;
      const matchesDay = dayOfMonth === '*' || parseInt(dayOfMonth) === currentDay;
      const matchesMonth = month === '*' || parseInt(month) === currentMonth;
      const matchesDayOfWeek = dayOfWeek === '*' || parseInt(dayOfWeek) === currentDayOfWeek;

      if (matchesMinute && matchesHour && matchesDay && matchesMonth && matchesDayOfWeek) {
        callback();
      }
    }, 60000); // Check every minute
  }

  /**
   * Calculate next run time
   */
  calculateNextRun(cronExpression, interval) {
    if (interval) {
      const nextTime = new Date();
      nextTime.setMilliseconds(nextTime.getMilliseconds() + interval);
      return nextTime.toISOString();
    }

    if (cronExpression) {
      // Simple next run calculation (very basic)
      // In production, use a library like cron-parser
      const nextTime = new Date();
      nextTime.setHours(nextTime.getHours() + 1);
      return nextTime.toISOString();
    }

    return null;
  }

  /**
   * List schedules
   */
  listSchedules(options = {}) {
    let result = [...this.schedules];

    if (options.workflowId) {
      result = result.filter(s => s.workflowId === options.workflowId);
    }

    if (options.enabled !== undefined) {
      result = result.filter(s => s.enabled === options.enabled);
    }

    // Sort by next run
    result.sort((a, b) => {
      const aTime = new Date(a.nextRun || 0).getTime();
      const bTime = new Date(b.nextRun || 0).getTime();
      return aTime - bTime;
    });

    const limit = options.limit || 100;
    const offset = options.offset || 0;
    return result.slice(offset, offset + limit);
  }

  /**
   * Enable schedule
   */
  async enableSchedule(scheduleId) {
    const schedule = this.getSchedule(scheduleId);
    if (schedule.enabled) return schedule;

    schedule.enabled = true;
    await this.saveSchedules();
    await this.activateSchedule(scheduleId);

    return schedule;
  }

  /**
   * Disable schedule
   */
  async disableSchedule(scheduleId) {
    const schedule = this.getSchedule(scheduleId);
    if (!schedule.enabled) return schedule;

    schedule.enabled = false;
    await this.deactivateSchedule(scheduleId);
    await this.saveSchedules();

    return schedule;
  }

  /**
   * Reactivate all enabled schedules (on restart)
   */
  async reactivateSchedules() {
    const enabledSchedules = this.schedules.filter(s => s.enabled);

    for (const schedule of enabledSchedules) {
      try {
        await this.activateSchedule(schedule.id);
      } catch (error) {
        this.logger?.error('Failed to reactivate schedule', {
          scheduleId: schedule.id,
          error: error.message
        });
      }
    }

    this.logger?.info('Schedules reactivated', { count: enabledSchedules.length });
  }

  /**
   * Manually trigger schedule
   */
  async triggerSchedule(scheduleId) {
    const schedule = this.getSchedule(scheduleId);

    try {
      const execution = await this.workflowExecutor.executeWorkflow(
        schedule.workflowId,
        schedule.input
      );

      schedule.lastRun = new Date().toISOString();
      schedule.executionCount += 1;
      schedule.lastResult = execution.outcome;
      await this.saveSchedules();

      return execution;
    } catch (error) {
      schedule.lastError = error.message;
      await this.saveSchedules();
      throw error;
    }
  }

  /**
   * Get schedule stats
   */
  getStats() {
    return {
      total: this.schedules.length,
      enabled: this.schedules.filter(s => s.enabled).length,
      active: this.activeSchedules.size,
      totalExecutions: this.schedules.reduce((sum, s) => sum + s.executionCount, 0),
      byType: {
        interval: this.schedules.filter(s => s.interval).length,
        cron: this.schedules.filter(s => s.cronExpression).length
      }
    };
  }
}

module.exports = WorkflowScheduler;
