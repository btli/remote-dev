"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DateTimePickerProps {
  date: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
  minDate?: Date;
  className?: string;
  placeholder?: string;
}

export function DateTimePicker({
  date,
  onDateChange,
  minDate,
  className,
  placeholder = "Pick date and time",
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) {
      onDateChange(undefined);
      return;
    }

    // Preserve existing time or use current time
    const currentHour = date?.getHours() ?? new Date().getHours();
    const currentMinute = date?.getMinutes() ?? 0;
    const currentSecond = date?.getSeconds() ?? 0;

    const newDate = new Date(selectedDate);
    newDate.setHours(currentHour);
    newDate.setMinutes(currentMinute);
    newDate.setSeconds(currentSecond);
    newDate.setMilliseconds(0);

    onDateChange(newDate);
  };

  const currentHours = date?.getHours() ?? 0;
  const isAM = currentHours < 12;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-8 text-xs",
            "bg-slate-800/50 border-white/10 hover:bg-slate-800 hover:border-white/20",
            !date && "text-slate-500",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-violet-400" />
          {date ? (
            format(date, "MMM d, yyyy 'at' h:mm:ss a")
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {/* Calendar - Left side */}
          <div className="p-2 border-r border-white/10">
            <Calendar
              mode="single"
              selected={date}
              onSelect={handleDateSelect}
              disabled={(d) => minDate ? d < new Date(minDate.setHours(0, 0, 0, 0)) : false}
              initialFocus
              className="rounded-md"
              classNames={{
                months: "flex flex-col",
                month: "space-y-0.5",
                caption: "flex justify-center pt-0.5 relative items-center h-6",
                caption_label: "text-[10px] font-medium text-white",
                nav: "space-x-1 flex items-center",
                nav_button: cn(
                  "h-4 w-4 bg-transparent p-0 text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                ),
                nav_button_previous: "absolute left-0",
                nav_button_next: "absolute right-0",
                table: "w-full border-collapse",
                head_row: "flex gap-0.5",
                head_cell: "text-slate-500 w-5 font-normal text-[8px] text-center",
                row: "flex w-full gap-0.5",
                cell: cn(
                  "relative p-0 text-center text-[9px] focus-within:relative focus-within:z-20"
                ),
                day: cn(
                  "h-5 w-5 p-0 font-normal text-[9px] rounded transition-colors",
                  "text-slate-300 hover:bg-violet-500/20 hover:text-white",
                  "focus:bg-violet-500/20 focus:text-white focus:outline-none"
                ),
                day_selected: "bg-violet-600 text-white hover:bg-violet-700 hover:text-white focus:bg-violet-700",
                day_today: "bg-slate-700 text-white",
                day_outside: "text-slate-600 opacity-50",
                day_disabled: "text-slate-600 opacity-50 cursor-not-allowed",
                day_hidden: "invisible",
              }}
            />
          </div>

          {/* Time Picker - Right side */}
          <div className="p-2 flex flex-col">
            <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-2">
              <Clock className="h-3 w-3 text-violet-400" />
              <span>Time</span>
            </div>

            {/* Scrollable time columns */}
            <div className="flex gap-1">
              {/* Hours */}
              <div className="flex flex-col items-center">
                <span className="text-[8px] text-slate-500 mb-1">HR</span>
                <ScrollArea className="h-[120px] w-8 rounded border border-white/10 bg-slate-800/30">
                  <div className="p-0.5">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((hour) => {
                      const displayHour = hour;
                      const actualHour = isAM ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12);
                      const isSelected = date && (date.getHours() % 12 || 12) === displayHour;
                      return (
                        <button
                          key={hour}
                          onClick={() => {
                            const baseDate = date || new Date();
                            const newDate = new Date(baseDate);
                            newDate.setHours(actualHour);
                            onDateChange(newDate);
                          }}
                          className={cn(
                            "w-full h-6 text-[10px] rounded transition-colors",
                            isSelected
                              ? "bg-violet-600 text-white"
                              : "text-slate-300 hover:bg-violet-500/20"
                          )}
                        >
                          {displayHour.toString().padStart(2, "0")}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* Minutes */}
              <div className="flex flex-col items-center">
                <span className="text-[8px] text-slate-500 mb-1">MIN</span>
                <ScrollArea className="h-[120px] w-8 rounded border border-white/10 bg-slate-800/30">
                  <div className="p-0.5">
                    {Array.from({ length: 60 }, (_, i) => i).map((minute) => {
                      const isSelected = date && date.getMinutes() === minute;
                      return (
                        <button
                          key={minute}
                          onClick={() => {
                            const baseDate = date || new Date();
                            const newDate = new Date(baseDate);
                            newDate.setMinutes(minute);
                            onDateChange(newDate);
                          }}
                          className={cn(
                            "w-full h-6 text-[10px] rounded transition-colors",
                            isSelected
                              ? "bg-violet-600 text-white"
                              : "text-slate-300 hover:bg-violet-500/20"
                          )}
                        >
                          {minute.toString().padStart(2, "0")}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* Seconds */}
              <div className="flex flex-col items-center">
                <span className="text-[8px] text-slate-500 mb-1">SEC</span>
                <ScrollArea className="h-[120px] w-8 rounded border border-white/10 bg-slate-800/30">
                  <div className="p-0.5">
                    {Array.from({ length: 60 }, (_, i) => i).map((second) => {
                      const isSelected = date && date.getSeconds() === second;
                      return (
                        <button
                          key={second}
                          onClick={() => {
                            const baseDate = date || new Date();
                            const newDate = new Date(baseDate);
                            newDate.setSeconds(second);
                            onDateChange(newDate);
                          }}
                          className={cn(
                            "w-full h-6 text-[10px] rounded transition-colors",
                            isSelected
                              ? "bg-violet-600 text-white"
                              : "text-slate-300 hover:bg-violet-500/20"
                          )}
                        >
                          {second.toString().padStart(2, "0")}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* AM/PM */}
              <div className="flex flex-col items-center">
                <span className="text-[8px] text-slate-500 mb-1">&nbsp;</span>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => {
                      if (!date) return;
                      const newDate = new Date(date);
                      const hours = newDate.getHours();
                      if (hours >= 12) newDate.setHours(hours - 12);
                      onDateChange(newDate);
                    }}
                    className={cn(
                      "w-8 h-8 text-[10px] rounded transition-colors",
                      isAM
                        ? "bg-violet-600 text-white"
                        : "bg-slate-800/50 text-slate-400 hover:bg-violet-500/20"
                    )}
                  >
                    AM
                  </button>
                  <button
                    onClick={() => {
                      if (!date) return;
                      const newDate = new Date(date);
                      const hours = newDate.getHours();
                      if (hours < 12) newDate.setHours(hours + 12);
                      onDateChange(newDate);
                    }}
                    className={cn(
                      "w-8 h-8 text-[10px] rounded transition-colors",
                      !isAM
                        ? "bg-violet-600 text-white"
                        : "bg-slate-800/50 text-slate-400 hover:bg-violet-500/20"
                    )}
                  >
                    PM
                  </button>
                </div>
              </div>
            </div>

            {/* Quick presets */}
            <div className="flex gap-1 pt-2 mt-2 border-t border-white/10">
              {[
                { label: "Now", offset: 0 },
                { label: "+5m", offset: 5 },
                { label: "+1h", offset: 60 },
              ].map(({ label, offset }) => (
                <Button
                  key={label}
                  variant="ghost"
                  size="sm"
                  className="flex-1 h-5 px-1 text-[9px] text-slate-400 hover:text-white hover:bg-violet-500/20"
                  onClick={() => {
                    // Preserve selected date, just update time
                    const now = new Date();
                    now.setMinutes(now.getMinutes() + offset);
                    const baseDate = date ? new Date(date) : now;
                    if (date) {
                      // Keep the selected date, use new time
                      baseDate.setHours(now.getHours());
                      baseDate.setMinutes(now.getMinutes());
                      baseDate.setSeconds(now.getSeconds());
                    }
                    onDateChange(baseDate);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Separate components for just date or just time if needed
export function DatePicker({
  date,
  onDateChange,
  minDate,
  className,
  placeholder = "Pick a date",
}: Omit<DateTimePickerProps, "placeholder"> & { placeholder?: string }) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-8 text-xs",
            "bg-slate-800/50 border-white/10 hover:bg-slate-800 hover:border-white/20",
            !date && "text-slate-500",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-violet-400" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={onDateChange}
          disabled={(d) => minDate ? d < new Date(minDate.setHours(0, 0, 0, 0)) : false}
          initialFocus
          classNames={{
            months: "flex flex-col",
            month: "space-y-2",
            caption: "flex justify-center pt-0.5 relative items-center",
            caption_label: "text-xs font-medium text-white",
            nav: "space-x-1 flex items-center",
            nav_button: cn(
              "h-6 w-6 bg-transparent p-0 text-slate-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            ),
            nav_button_previous: "absolute left-0.5",
            nav_button_next: "absolute right-0.5",
            table: "w-full border-collapse space-y-0.5",
            head_row: "flex",
            head_cell: "text-slate-500 rounded-md w-7 font-normal text-[10px]",
            row: "flex w-full mt-0.5",
            cell: cn(
              "relative p-0 text-center text-xs focus-within:relative focus-within:z-20",
              "first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            ),
            day: cn(
              "h-7 w-7 p-0 font-normal text-xs rounded-md transition-colors",
              "text-slate-300 hover:bg-violet-500/20 hover:text-white",
              "focus:bg-violet-500/20 focus:text-white focus:outline-none"
            ),
            day_selected: "bg-violet-600 text-white hover:bg-violet-700 hover:text-white focus:bg-violet-700",
            day_today: "bg-slate-700 text-white",
            day_outside: "text-slate-600 opacity-50",
            day_disabled: "text-slate-600 opacity-50 cursor-not-allowed",
            day_hidden: "invisible",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface TimePickerProps {
  time: { hour: number; minute: number; second?: number } | undefined;
  onTimeChange: (time: { hour: number; minute: number; second: number }) => void;
  className?: string;
}

export function TimePicker({
  time,
  onTimeChange,
  className,
}: TimePickerProps) {
  const [timeInput, setTimeInput] = React.useState("");

  React.useEffect(() => {
    if (time) {
      const hours = time.hour;
      const minutes = time.minute;
      const seconds = time.second ?? 0;
      const ampm = hours >= 12 ? "PM" : "AM";
      const displayHours = hours % 12 || 12;
      setTimeInput(
        `${displayHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")} ${ampm}`
      );
    }
  }, [time]);

  const parseAndUpdateTime = (input: string) => {
    const timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;
    const match = input.trim().match(timeRegex);

    if (!match) return;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;
    const ampm = match[4]?.toUpperCase();

    if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return;

    if (ampm) {
      if (hours < 1 || hours > 12) return;
      if (ampm === "PM" && hours !== 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
    } else {
      if (hours < 0 || hours > 23) return;
    }

    onTimeChange({ hour: hours, minute: minutes, second: seconds });
  };

  const isAM = (time?.hour ?? 0) < 12;

  const toggleAmPm = () => {
    if (!time) return;
    const hours = time.hour;
    onTimeChange({
      hour: hours >= 12 ? hours - 12 : hours + 12,
      minute: time.minute,
      second: time.second ?? 0,
    });
  };

  const adjustTime = (field: "hour" | "minute" | "second", delta: number) => {
    const current = time ?? { hour: 0, minute: 0, second: 0 };
    let { hour, minute, second } = current;
    second = second ?? 0;

    if (field === "hour") {
      hour = (hour + delta + 24) % 24;
    } else if (field === "minute") {
      minute = (minute + delta + 60) % 60;
    } else {
      second = (second + delta + 60) % 60;
    }

    onTimeChange({ hour, minute, second });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1 text-[10px] text-slate-400">
        <Clock className="h-3 w-3 text-violet-400" />
        <span>Time</span>
      </div>

      <Input
        value={timeInput}
        onChange={(e) => setTimeInput(e.target.value)}
        onBlur={() => parseAndUpdateTime(timeInput)}
        onKeyDown={(e) => e.key === "Enter" && parseAndUpdateTime(timeInput)}
        placeholder="12:00:00 PM"
        className="h-7 text-xs font-mono bg-slate-800/50 border-white/10 text-center"
      />

      <div className="grid grid-cols-3 gap-1">
        {(["hour", "minute", "second"] as const).map((field) => (
          <div key={field} className="flex flex-col items-center gap-0.5">
            <button
              onClick={() => adjustTime(field, 1)}
              className="w-full h-5 text-[10px] text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors"
            >
              ▲
            </button>
            <span className="text-[10px] text-slate-500">
              {field === "hour" ? "hr" : field === "minute" ? "min" : "sec"}
            </span>
            <button
              onClick={() => adjustTime(field, -1)}
              className="w-full h-5 text-[10px] text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors"
            >
              ▼
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-1">
        <button
          onClick={toggleAmPm}
          className={cn(
            "flex-1 h-6 text-[10px] rounded transition-colors",
            isAM
              ? "bg-violet-600 text-white"
              : "bg-slate-800/50 text-slate-400 hover:text-white hover:bg-white/10"
          )}
        >
          AM
        </button>
        <button
          onClick={toggleAmPm}
          className={cn(
            "flex-1 h-6 text-[10px] rounded transition-colors",
            !isAM
              ? "bg-violet-600 text-white"
              : "bg-slate-800/50 text-slate-400 hover:text-white hover:bg-white/10"
          )}
        >
          PM
        </button>
      </div>
    </div>
  );
}
